const mongoose = require('mongoose');

const platformInvestmentSchema = new mongoose.Schema({
    platformName: {
        type: String,
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
    returnPercentage: {
        type: Number,
        default: 0
    },
    currentValue: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['active', 'closed'],
        default: 'active'
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('PlatformInvestment', platformInvestmentSchema);