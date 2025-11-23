const mongoose = require('mongoose');

// --- 1. User Schema ---
// Defines the structure for user accounts (needed for login/signup).
const userSchema = new mongoose.Schema({
  username: { 
    type: String, 
    required: true, 
    unique: true // Ensures no two users share the same username
  },
  password: { 
    type: String, 
    required: true // Stores the bcrypt HASH of the password
  }, 
  isOnline: { 
    type: Boolean, 
    default: false // Tracks online status for the active user list
  },
  socketId: { 
    type: String // Maps the persistent user ID to the current live socket connection
  }
});

// --- 2. Message Schema ---
// Defines the structure for a single message instance.
const messageSchema = new mongoose.Schema({
  conversationId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Conversation', // Links the message to its specific chat room
    required: true
  },
  sender: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', // Links the message to the user who sent it
    required: true
  },
  content: { 
    type: String 
  },
  type: { 
    type: String, 
    enum: ['text', 'file'], 
    default: 'text' // Supports text and file payloads
  },
  fileUrl: { 
    type: String // URL for uploaded files
  },
  readBy: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' // Array of user IDs who have read this message (The Blue Tick logic)
  }]
}, { 
    timestamps: true // Automatically adds createdAt and updatedAt fields
});

// --- 3. Conversation Schema ---
// Defines the structure for a chat room (can be 1:1 or group, though currently used for 1:1).
const conversationSchema = new mongoose.Schema({
  participants: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' // Array of users in this chat
  }],
  lastMessage: { 
    type: String // Used for displaying a preview in the sidebar
  },
  lastMessageTime: { 
    type: Date, 
    default: Date.now // Used for sorting conversations in the sidebar
  }
});

// --- Exports ---
module.exports = {
  User: mongoose.model('User', userSchema),
  Message: mongoose.model('Message', messageSchema),
  Conversation: mongoose.model('Conversation', conversationSchema)
};