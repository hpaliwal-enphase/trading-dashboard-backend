const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { encrypt, decrypt } = require('../utils/encryption');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true
    },
    role: {
        type: String,
        enum: ['admin', 'client'],
        default: 'client'
    },
    pin: {
        type: String,
        required: function () {
            return this.role === 'client';
        }
    },
    encryptedPin: {
        type: String,
        required: function () {
            return this.role === 'client';
        }
    },
    password: {
        type: String,
        required: function () {
            return this.role === 'admin';
        }
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Generate 6-digit PIN for clients
userSchema.methods.generatePin = function () {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// Hash password and encrypt PIN before saving
userSchema.pre('save', async function (next) {
    /**
    console.log('=== PRE-SAVE HOOK START ===');
    console.log('Document:', {
        email: this.email,
        role: this.role,
        isNew: this.isNew,
        pinModified: this.isModified('pin'),
        passwordModified: this.isModified('password'),
        hasPin: !!this.pin,
        hasPassword: !!this.password
    });
     */

    try {
        // Handle admin password hashing
        if (this.role === 'admin' && this.isModified('password') && this.password) {
            this.password = await bcrypt.hash(this.password, 10);
        }

        // Handle client PIN encryption and hashing
        if (this.role === 'client' && this.isModified('pin') && this.pin) {

            // Store encrypted version for admin to decrypt
            this.encryptedPin = encrypt(this.pin);

            // Hash PIN for secure comparison during login
            this.pin = await bcrypt.hash(this.pin, 10);
        }

        next();
    } catch (error) {
        next(error);
    }
});

// Compare password
userSchema.methods.comparePassword = async function (password) {
    return await bcrypt.compare(password, this.password);
};

// Compare PIN
userSchema.methods.comparePin = async function (pin) {
    return await bcrypt.compare(pin, this.pin);
};

// Get decrypted PIN (for admin use only)
userSchema.methods.getDecryptedPin = function () {
    if (this.encryptedPin) {
        return decrypt(this.encryptedPin);
    }
    return null;
};

const User = mongoose.model('User', userSchema);
module.exports = User;