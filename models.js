const mongoose = require('mongoose');

// --- 1. User Schema ---
const userSchema = new mongoose.Schema({
  username: { 
    type: String, 
    required: true, 
    unique: true 
  },
  password: { 
    type: String, 
    required: true 
  }, 
  isOnline: { 
    type: Boolean, 
    default: false 
  },
  socketId: { 
    type: String 
  }
});

// --- 2. Message Schema ---
const messageSchema = new mongoose.Schema({
  conversationId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Conversation', 
    required: true
  },
  sender: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true
  },
  content: { 
    type: String 
  },
  type: { 
    type: String, 
    enum: ['text', 'file'], 
    default: 'text' 
  },
  fileUrl: { 
    type: String 
  },
  readBy: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }]
}, { 
    timestamps: true 
});

// --- 3. Conversation Schema ---
const conversationSchema = new mongoose.Schema({
  participants: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }],
  lastMessage: { 
    type: String 
  },
  lastMessageTime: { 
    type: Date, 
    default: Date.now 
  }
});

// --- Exports ---
module.exports = {
  User: mongoose.model('User', userSchema),
  Message: mongoose.model('Message', messageSchema),
  Conversation: mongoose.model('Conversation', conversationSchema)
};
