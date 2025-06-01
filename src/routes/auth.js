const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');

const router = express.Router();

// Admin login
router.post('/admin/login', [
    body('email').isEmail(),
    body('password').notEmpty()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password } = req.body;
        console.log(req.body);
        const user = await User.findOne({ email, role: 'admin' });

        console.log(user);
        if (!user || !(await user.comparePassword(password))) {
            console.log(await user.comparePassword(password));
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { userId: user._id },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Client login
router.post('/client/login', [
    body('pin').isLength({ min: 6, max: 6 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { pin } = req.body;

        // Find all clients and check PIN
        const clients = await User.find({ role: 'client' });
        let authenticatedUser = null;

        for (const client of clients) {
            if (await client.comparePin(pin)) {
                authenticatedUser = client;
                break;
            }
        }

        if (!authenticatedUser) {
            return res.status(401).json({ error: 'Invalid PIN' });
        }

        const token = jwt.sign(
            { userId: authenticatedUser._id },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: {
                id: authenticatedUser._id,
                name: authenticatedUser.name,
                email: authenticatedUser.email,
                role: authenticatedUser.role
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;