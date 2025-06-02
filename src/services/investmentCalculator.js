// src/services/investmentCalculator.js
const Investment = require('../models/Investment');
const MonthlyReturn = require('../models/MonthlyReturn');
const PlatformInvestment = require('../models/PlatformInvestment');
const User = require('../models/User');

class InvestmentCalculator {
    /**
     * Recalculate all returns from a specific date
     */
    static async recalculateFromDate(fromDate) {
        console.log(`Starting recalculation from ${fromDate}`);

        // Get all months that need recalculation
        const months = await this.getMonthsFromDate(fromDate);

        for (const month of months) {
            await this.calculateMonthlyReturns(month);
        }

        return { success: true, monthsRecalculated: months.length };
    }

    /**
     * Calculate returns for a specific month
     */
    static async calculateMonthlyReturns(monthDate) {
        const startOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
        const endOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);

        // Get total corpus at month end
        const corpusData = await this.getCorpusAtDate(endOfMonth);

        // Get platform returns for the month
        const platformReturns = await this.getPlatformReturns(startOfMonth, endOfMonth);

        // Calculate total return percentage
        const totalReturnPercentage = this.calculateWeightedReturn(platformReturns);

        // Calculate each client's share and returns
        const clientReturns = await this.calculateClientReturns(
            corpusData,
            totalReturnPercentage,
            endOfMonth
        );

        // Save or update monthly return record
        await MonthlyReturn.findOneAndUpdate(
            { month: startOfMonth },
            {
                month: startOfMonth,
                totalCorpus: corpusData.totalCorpus,
                totalPlatformValue: platformReturns.totalValue,
                monthlyReturnPercentage: totalReturnPercentage,
                clientReturns: clientReturns,
                platformReturns: platformReturns.platforms,
                calculatedAt: new Date()
            },
            { upsert: true, new: true }
        );
    }

    /**
     * Get total corpus and client shares at a specific date
     */
    static async getCorpusAtDate(date) {
        // Get all investments up to this date
        const investments = await Investment.find({
            investmentDate: { $lte: date },
            status: 'active'
        }).populate('clientId');

        // Group by client
        const clientInvestments = {};
        let totalCorpus = 0;

        investments.forEach(inv => {
            const clientId = inv.clientId._id.toString();
            if (!clientInvestments[clientId]) {
                clientInvestments[clientId] = {
                    clientId: clientId,
                    clientName: inv.clientId.name,
                    totalInvestment: 0
                };
            }

            const amount = inv.type === 'withdrawal' ? -inv.amount : inv.amount;
            clientInvestments[clientId].totalInvestment += amount;
            totalCorpus += amount;
        });

        // Calculate percentages - handle zero corpus case
        Object.values(clientInvestments).forEach(client => {
            if (totalCorpus === 0) {
                client.sharePercentage = 0;
            } else {
                client.sharePercentage = parseFloat((client.totalInvestment / totalCorpus * 100).toFixed(2));
            }
        });

        return {
            totalCorpus: totalCorpus || 0, // Ensure it's never undefined/NaN
            clientShares: Object.values(clientInvestments)
        };
    }

    /**
     * Get platform returns for a month
     */
    static async getPlatformReturns(startDate, endDate) {
        const platforms = await PlatformInvestment.find({
            investmentDate: { $lte: endDate },
            status: 'active'
        });

        let totalValue = 0;
        const platformData = platforms.map(platform => {
            totalValue += platform.currentValue;
            return {
                platformId: platform._id,
                platformName: platform.platformName,
                returnPercentage: platform.returnPercentage,
                currentValue: platform.currentValue
            };
        });

        return {
            totalValue,
            platforms: platformData
        };
    }

    /**
     * Calculate weighted return across all platforms
     */
    static calculateWeightedReturn(platformReturns) {
        if (!platformReturns.totalValue || platformReturns.totalValue === 0) {
            return 0;
        }

        let weightedReturn = 0;
        const totalValue = platformReturns.totalValue;

        platformReturns.platforms.forEach(platform => {
            const weight = platform.currentValue / totalValue;
            weightedReturn += (platform.returnPercentage || 0) * weight;
        });

        return weightedReturn;
    }

    /**
     * Calculate returns for each client based on their share
     */
    static async calculateClientReturns(corpusData, returnPercentage, date) {
        const clientReturns = [];

        for (const clientShare of corpusData.clientShares) {
            // Get previous month's closing balance
            const previousBalance = await this.getPreviousClosingBalance(
                clientShare.clientId,
                date
            );

            const currentInvestment = clientShare.totalInvestment;
            const returnAmount = currentInvestment * (returnPercentage / 100);
            const closingBalance = currentInvestment + returnAmount;

            clientReturns.push({
                clientId: clientShare.clientId,
                investmentShare: currentInvestment,
                sharePercentage: clientShare.sharePercentage,
                returnAmount: returnAmount,
                closingBalance: closingBalance
            });
        }

        return clientReturns;
    }

    /**
     * Get all months from a specific date to now
     */
    static async getMonthsFromDate(fromDate) {
        const months = [];
        const current = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
        const now = new Date();

        while (current <= now) {
            months.push(new Date(current));
            current.setMonth(current.getMonth() + 1);
        }

        return months;
    }

    /**
     * Get previous month's closing balance for a client
     */
    static async getPreviousClosingBalance(clientId, date) {
        const previousMonth = new Date(date.getFullYear(), date.getMonth() - 1, 1);

        const previousReturn = await MonthlyReturn.findOne({
            month: previousMonth,
            'clientReturns.clientId': clientId
        });

        if (previousReturn) {
            const clientReturn = previousReturn.clientReturns.find(
                cr => cr.clientId.toString() === clientId
            );
            return clientReturn ? clientReturn.closingBalance : 0;
        }

        return 0;
    }
}

module.exports = InvestmentCalculator;