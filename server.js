const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs'); 

// Import our Models (Ensure models.js is in the same directory)
const { User, Message, Conversation } = require('./models');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    maxHttpBufferSize: 1e7, 
    cors: { origin: "*" } 
});

// --- CONFIGURATION ---
const PORT = 3000;
const MONGO_URI = 'mongodb://127.0.0.1:27017/whatsapp_clone'; 

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

app.use('/uploads', express.static(UPLOADS_DIR));
app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));

// --- DB CONNECTION ---
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB Error:', err));

// --- HELPER FUNCTIONS ---

/**
 * Calculates and broadcasts unread counts for all conversations of a given user.
 * FIX: Uses $nin for accurate counting of unread messages.
 */
async function sendUnreadCounts(userId) {
    try {
        const userObjectId = new mongoose.Types.ObjectId(userId);
        const conversations = await Conversation.find({ participants: userId });
        const unreadUpdates = [];

        for (const convo of conversations) {
            
            // CRITICAL FIX: Use $nin (Not In) to correctly count messages where 
            // the user's ID is NOT in the readBy array.
            const unreadCount = await Message.countDocuments({
                conversationId: convo._id,
                sender: { $ne: userObjectId }, 
                readBy: { $nin: [userObjectId] }  
            });
            
            if (unreadCount > 0) {
                // Find the ID of the other participant for the client-side UI to know where to put the badge
                const targetUserId = convo.participants.find(pId => pId.toString() !== userId).toString();
                
                unreadUpdates.push({
                    conversationId: convo._id.toString(),
                    count: unreadCount,
                    targetUserId: targetUserId
                });
            }
        }
        
        const user = await User.findById(userId);
        const userSocket = user ? io.sockets.sockets.get(user.socketId) : null;

        if (userSocket) {
            userSocket.emit('unread_updates', unreadUpdates);
        }

    } catch (error) {
        console.error("Unread Count Error:", error);
    }
}

/**
 * Retrieves all online users and broadcasts the list to all connected clients.
 */
async function broadcastActiveUsers() {
    const onlineUsers = await User.find({ isOnline: true });
    io.emit('active_users', onlineUsers.map(u => ({ 
        id: u._id.toString(), 
        username: u.username 
    })));
}


// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // 1. Authentication Handlers
    socket.on('signup', async ({ username, password }) => {
        try {
            const existingUser = await User.findOne({ username });
            if (existingUser) {
                socket.emit('auth_error', 'Username already taken');
                return;
            }
            const hashedPassword = await bcrypt.hash(password, 10);
            const newUser = await User.create({
                username, password: hashedPassword, isOnline: true, socketId: socket.id
            });
            socket.userId = newUser._id.toString();
            socket.username = newUser.username;
            socket.emit('registration_success', { myId: newUser._id.toString() });
            broadcastActiveUsers();
        } catch (err) {
            console.error(err);
            socket.emit('auth_error', 'Signup failed');
        }
    });

    socket.on('login', async ({ username, password }) => {
        try {
            const user = await User.findOne({ username });
            if (!user) {
                socket.emit('auth_error', 'User not found');
                return;
            }
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                socket.emit('auth_error', 'Incorrect password');
                return;
            }
            // CRITICAL: Update socketId on login/reconnect
            user.isOnline = true;
            user.socketId = socket.id;
            await user.save(); 
            socket.userId = user._id.toString();
            socket.username = user.username;
            socket.emit('registration_success', { myId: user._id.toString() });
            broadcastActiveUsers();
            sendUnreadCounts(user._id.toString()); 
        } catch (err) {
            console.error(err);
            socket.emit('auth_error', 'Login failed');
        }
    });

    // Request to refresh the active users list (used after notifications)
    socket.on('get_current_active_users', broadcastActiveUsers); 

    // 2. JOIN PRIVATE CHAT (Find/Create Conversation)
    socket.on('join_private_chat', async ({ targetUserId }) => {
        try {
            const myId = socket.userId;
            
            if (!myId) {
                console.error("ERROR: socket.userId is missing. User is not authenticated.");
                return;
            }

            let conversation = await Conversation.findOne({
                participants: { $all: [myId, targetUserId] }
            });

            if (!conversation) {
                conversation = await Conversation.create({
                    participants: [myId, targetUserId],
                    lastMessage: 'Start a conversation'
                });
            }

            const roomId = conversation._id.toString();
            socket.join(roomId);

            const messages = await Message.find({ conversationId: conversation._id })
                .sort({ createdAt: 1 })
                .populate('sender', 'username'); 

            const history = messages.map(m => ({
                id: m._id,
                senderId: m.sender._id.toString(),
                senderName: m.sender.username,
                content: m.content,
                type: m.type,
                fileUrl: m.fileUrl,
                timestamp: m.createdAt,
                readBy: m.readBy.map(id => id.toString()) 
            }));

            const targetUser = await User.findById(targetUserId);

            socket.emit('chat_room_loaded', {
                roomId: roomId,
                history: history,
                targetUser: { id: targetUser._id.toString(), username: targetUser.username }
            });

        } catch (err) {
            console.error("FATAL Join Chat Error:", err);
        }
    });

    // 3. SEND MESSAGE (Persist to DB) - FINAL VERSION
    socket.on('send_private_message', async (payload) => {
        try {
            const { roomId, content, fileData, fileName } = payload;
            
            const messageData = {
                conversationId: roomId,
                sender: socket.userId,
                content: content || '',
                type: 'text',
                readBy: [socket.userId] 
            };

            // File Handling (simplified)
            if (fileData) {
                const base64Data = fileData.split(',')[1];
                const uniqueName = `${Date.now()}-${socket.userId}${path.extname(fileName)}`;
                const filePath = path.join(UPLOADS_DIR, uniqueName);
                await fs.promises.writeFile(filePath, base64Data, 'base64');
                messageData.type = 'file';
                messageData.fileUrl = `/uploads/${uniqueName}`;
                messageData.content = content || fileName;
            }

            const savedMessage = await Message.create(messageData);

            await Conversation.findByIdAndUpdate(roomId, {
                lastMessage: messageData.type === 'file' ? '📎 Attachment' : messageData.content,
                lastMessageTime: new Date()
            });

            const messagePayload = {
                id: savedMessage._id,
                senderId: socket.userId,
                senderName: socket.username,
                content: savedMessage.content,
                type: savedMessage.type,
                fileUrl: savedMessage.fileUrl,
                timestamp: savedMessage.createdAt,
                roomId: roomId,
                readBy: savedMessage.readBy.map(id => id.toString())
            };

            // 1. Emit message to the room
            io.to(roomId).emit('new_message', messagePayload);
            
            // 2. Find the recipient ID
            const conversation = await Conversation.findById(roomId);
            const recipientId = conversation.participants.find(pId => pId.toString() !== socket.userId).toString();
            
            // 3. CRITICAL FIX: Force fetch the recipient's latest record to get the fresh socketId
            const recipientUser = await User.findById(recipientId); 

            // 4. Update Unread Counts for the recipient
            sendUnreadCounts(recipientId);

            // 5. Send a direct notification to the recipient's active socket
            if (recipientUser && recipientUser.socketId) {
                const recipientSocket = io.sockets.sockets.get(recipientUser.socketId);
                
                if (recipientSocket) {
                    recipientSocket.emit('message_received_notification', {
                        senderId: socket.userId,
                        senderName: socket.username
                    });
                    console.log(`Notification sent successfully to ${recipientUser.username}.`);
                } else {
                    console.warn(`Recipient ${recipientUser.username} is logged in but socket ${recipientUser.socketId} is not currently connected.`);
                }
            }

        } catch (err) {
            console.error("Send Error:", err);
        }
    });

    // 4. MARK MESSAGES AS READ (Blue Ticks)
    socket.on('mark_messages_read', async ({ roomId }) => {
        try {
            const myId = socket.userId;
            
            await Message.updateMany(
                { conversationId: roomId, sender: { $ne: myId }, readBy: { $ne: myId } },
                { $addToSet: { readBy: myId } }
            );

            io.to(roomId).emit('messages_read_update', {
                roomId: roomId,
                readerId: myId
            });
            
            sendUnreadCounts(myId);

        } catch (err) {
            console.error("Read status error:", err);
        }
    });

    // 5. TYPING INDICATORS (Private Rooms)
    socket.on('typing_start', ({ roomId }) => {
        const sender = { id: socket.userId, username: socket.username };
        if (sender && roomId) {
            socket.to(roomId).emit('typing_status', { 
                userId: sender.id, 
                username: sender.username, 
                roomId: roomId,
                isTyping: true 
            });
        }
    });

    socket.on('typing_stop', ({ roomId }) => {
        const sender = { id: socket.userId, username: socket.username };
        if (sender && roomId) {
            socket.to(roomId).emit('typing_status', { 
                userId: sender.id, 
                username: sender.username, 
                roomId: roomId,
                isTyping: false 
            });
        }
    });


    // 6. DISCONNECT
    socket.on('disconnect', async () => {
        if (socket.userId) {
            // Set user to offline when disconnecting
            await User.findByIdAndUpdate(socket.userId, { isOnline: false, socketId: null });
            broadcastActiveUsers();
        }
    });
});

server.listen(PORT, () => {
    console.log(`🔒 Secure, Persistent Chat Server running on http://localhost:${PORT}`);
});