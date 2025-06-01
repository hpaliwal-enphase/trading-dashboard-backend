const mongoose = require('mongoose');

const currencyDataSchema = new mongoose.Schema({
  platformId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Platform',
    required: true
  },
  value: {
    type: Number,
    required: true,
    min: 0
  },
  date: {
    type: Date,
    required: true
  },
  week: {
    type: Number,
    required: true
  },
  year: {
    type: Number,
    required: true
  },
  enteredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Compound index for unique weekly entries per platform
currencyDataSchema.index({ platformId: 1, week: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('CurrencyData', currencyDataSchema);