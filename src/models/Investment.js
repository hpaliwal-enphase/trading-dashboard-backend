// src/models/Investment.js
const mongoose = require('mongoose');

const investmentSchema = new mongoose.Schema({
    clientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    investmentDate: {
        type: Date,
        required: true
    },
    type: {
        type: String,
        enum: ['deposit', 'withdrawal'],
        default: 'deposit'
    },
    isEdited: {
        type: Boolean,
        default: false
    },
    editHistory: [{
        previousAmount: Number,
        newAmount: Number,
        editedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Admin'
        },
        editedAt: {
            type: Date,
            default: Date.now
        },
        reason: String
    }],
    status: {
        type: String,
        enum: ['active', 'cancelled'],
        default: 'active'
    }
}, {
    timestamps: true
});

// Index for efficient date-based queries
investmentSchema.index({ investmentDate: 1 });
investmentSchema.index({ clientId: 1, investmentDate: 1});

module.exports = mongoose.model('Investment', investmentSchema);