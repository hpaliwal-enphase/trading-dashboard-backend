const mongoose = require('mongoose');

const weeklyPlatformDataSchema = new mongoose.Schema({
    platformId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PlatformInvestment',
        required: true
    },
    weekStartDate: {
        type: Date,
        required: true
    },
    weekEndDate: {
        type: Date,
        required: true
    },
    weekNumber: {
        type: Number,
        required: true
    },
    year: {
        type: Number,
        required: true
    },
    openingValue: {
        type: Number,
        required: true
    },
    closingValue: {
        type: Number,
        required: true
    },
    weeklyReturn: {
        type: Number, // Percentage
        required: true
    },
    profitAmount: {
        type: Number,
        required: true
    },
    notes: String,
    enteredBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    isInterpolated: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

// Compound index to prevent duplicate entries
weeklyPlatformDataSchema.index({ platformId: 1, weekStartDate: 1 }, { unique: true });

module.exports = mongoose.model('WeeklyPlatformData', weeklyPlatformDataSchema);