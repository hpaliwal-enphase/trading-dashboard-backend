const mongoose = require('mongoose');

const monthlyReturnSchema = new mongoose.Schema({
    month: {
        type: Date,
        required: true
    },
    totalCorpus: {
        type: Number,
        required: true
    },
    totalPlatformValue: {
        type: Number,
        required: true
    },
    monthlyReturnPercentage: {
        type: Number,
        required: true
    },
    clientReturns: [{
        clientId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        investmentShare: Number, // Client's share of corpus
        sharePercentage: Number, // Percentage of total corpus
        returnAmount: Number,
        closingBalance: Number
    }],
    platformReturns: [{
        platformId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'PlatformInvestment'
        },
        returnPercentage: Number,
        returnAmount: Number
    }],
    calculatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Ensure unique month entries
monthlyReturnSchema.index({ month: 1 }, { unique: true });

module.exports = mongoose.model('MonthlyReturn', monthlyReturnSchema);