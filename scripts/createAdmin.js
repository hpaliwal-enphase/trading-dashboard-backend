require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../src/models/User');

async function createAdmin() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trading-dashboard');

        const adminEmail = 'admin@example.com';
        const adminPassword = 'admin123'; // Change this!

        // Check if admin already exists
        const existingAdmin = await User.findOne({ email: adminEmail, role: 'admin' });
        if (existingAdmin) {
            console.log('Admin already exists');
            process.exit(0);
        }

        // Create admin user
        const hashedPassword = await bcrypt.hash(adminPassword, 10);
        const admin = new User({
            name: 'Admin User',
            email: adminEmail,
            role: 'admin',
            password: hashedPassword
        });

        await admin.save();
        console.log('Admin created successfully');
        console.log('Email:', adminEmail);
        console.log('Password:', adminPassword);
        console.log('Please change the password after first login!');

    } catch (error) {
        console.error('Error creating admin:', error);
    } finally {
        await mongoose.disconnect();
    }
}

createAdmin();