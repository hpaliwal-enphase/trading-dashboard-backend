const express = require('express');
const { body, validationResult } = require('express-validator');
const Platform = require('../models/Platform');
const CurrencyData = require('../models/CurrencyData');
const { adminAuth } = require('../middleware/auth');

const router = express.Router();

// Get all platforms
router.get('/', adminAuth, async (req, res) => {
  try {
    const platforms = await Platform.find({ isActive: true });
    res.json(platforms);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new platform
router.post('/', adminAuth, [
  body('name').notEmpty().trim(),
  body('description').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, description } = req.body;
    
    const platform = new Platform({
      name,
      description
    });

    await platform.save();
    res.status(201).json(platform);
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({ error: 'Platform name already exists' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Get platform currency data
router.get('/:platformId/data', adminAuth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = { platformId: req.params.platformId };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const data = await CurrencyData.find(query)
      .sort('-date')
      .populate('platformId', 'name')
      .populate('enteredBy', 'name');

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;