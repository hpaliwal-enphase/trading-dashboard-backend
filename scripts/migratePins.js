require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const { encrypt } = require('../src/utils/encryption');

async function migratePins() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trading-dashboard');

        console.log('Starting PIN migration...');

        // Find all clients
        const clients = await User.find({ role: 'client' });

        console.log(`Found ${clients.length} clients to migrate`);

        for (const client of clients) {
            // Skip if already has encrypted PIN
            if (client.encryptedPin) {
                console.log(`Client ${client.email} already migrated`);
                continue;
            }

            // Generate a new PIN for clients without encryptedPin
            const newPin = client.generatePin();
            console.log(`Generating new PIN for ${client.email}: ${newPin}`);

            // Set the PIN (will be encrypted in pre-save hook)
            client.pin = newPin;
            await client.save();

            console.log(`Migrated client ${client.email}`);
        }

        console.log('Migration completed successfully');

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        await mongoose.disconnect();
    }
}

migratePins();