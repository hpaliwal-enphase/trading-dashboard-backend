const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Investment = require('../models/Investment');
const CurrencyData = require('../models/CurrencyData');
const AuditLog = require('../models/AuditLog');
const { adminAuth } = require('../middleware/auth');
const InvestmentCalculator = require('../services/investmentCalculator');
const MonthlyReturn = require('../models/MonthlyReturn');
const PlatformInvestment = require('../models/PlatformInvestment');

const router = express.Router();

// Get all clients with search
router.get('/clients', adminAuth, async (req, res) => {
    try {
        const { search } = req.query;
        let query = { role: 'client' };

        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }

        const clients = await User.find(query).select('-password -pin');

        // Get investment data for each client
        const clientsWithInvestments = await Promise.all(
            clients.map(async (client) => {
                const investments = await Investment.find({
                    clientId: client._id,
                    status: 'active'
                });

                // Calculate total investment (deposits - withdrawals)
                const totalInvestment = investments.reduce((sum, inv) => {
                    return sum + (inv.type === 'withdrawal' ? -inv.amount : inv.amount);
                }, 0);

                // Get the latest monthly return for current value
                const latestReturn = await MonthlyReturn.findOne({
                    'clientReturns.clientId': client._id
                })
                    .sort('-month')
                    .lean();

                let currentValue = totalInvestment;
                if (latestReturn) {
                    const clientReturn = latestReturn.clientReturns.find(
                        cr => cr.clientId.toString() === client._id.toString()
                    );
                    if (clientReturn && clientReturn.closingBalance) {
                        currentValue = clientReturn.closingBalance;
                    }
                }

                const totalReturn = totalInvestment > 0
                    ? ((currentValue - totalInvestment) / totalInvestment * 100).toFixed(2)
                    : 0;

                return {
                    ...client.toObject(),
                    totalInvestment: totalInvestment || 0,
                    currentValue: currentValue || 0,
                    totalReturn: parseFloat(totalReturn) || 0
                };
            })
        );

        res.json(clientsWithInvestments);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get specific client details
// Update the get specific client details endpoint
router.get('/clients/:clientId', adminAuth, async (req, res) => {
    try {
        const client = await User.findOne({
            _id: req.params.clientId,
            role: 'client'
        }).select('-password');

        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }

        // Log PIN view action
        await AuditLog.create({
            adminId: req.user._id,
            action: 'view_pin',
            clientId: client._id,
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });

        const investments = await Investment.find({ clientId: client._id });

        // Decrypt PIN for admin
        const clientData = client.toObject();
        clientData.displayPin = client.getDecryptedPin();
        delete clientData.pin; // Remove hashed PIN
        delete clientData.encryptedPin; // Remove encrypted PIN from response

        res.json({
            client: clientData,
            investments
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create new client
// Update create new client endpoint to return the plain PIN
router.post('/clients', adminAuth, [
    body('name').notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email is required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { name, email } = req.body;
        // Check if email already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'Email already exists' });
        }

        // Create new instance (don't use .create())
        const user = new User({
            name,
            email,
            role: 'client'
        });

        // Generate and set PIN
        const plainPin = user.generatePin();
        user.pin = plainPin;

        // Use .save() to trigger hooks
        await user.save({ validateBeforeSave: false });

        // Log client creation
        await AuditLog.create({
            adminId: req.user.id,
            action: 'create_client',
            clientId: user._id,
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });

        res.status(201).json({
            message: 'Client created successfully',
            client: {
                id: user._id,
                name: user.name,
                email: user.email,
                pin: plainPin // Return the plain PIN
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// Update reset PIN endpoint
router.post('/clients/:clientId/reset-pin', adminAuth, async (req, res) => {
    try {
        const client = await User.findOne({
            _id: req.params.clientId,
            role: 'client'
        });

        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }

        // Generate new PIN
        const newPin = client.generatePin();
        client.pin = newPin;
        await client.save();

        // Log PIN reset action
        await AuditLog.create({
            adminId: req.user._id,
            action: 'reset_pin',
            clientId: client._id,
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });

        res.json({
            message: 'PIN reset successfully',
            pin: newPin
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Add endpoint to view audit logs
router.get('/audit-logs', adminAuth, async (req, res) => {
    try {
        const { clientId, action, startDate, endDate } = req.query;
        let query = {};

        if (clientId) query.clientId = clientId;
        if (action) query.action = action;
        if (startDate || endDate) {
            query.timestamp = {};
            if (startDate) query.timestamp.$gte = new Date(startDate);
            if (endDate) query.timestamp.$lte = new Date(endDate);
        }

        const logs = await AuditLog.find(query)
            .populate('adminId', 'name email')
            .populate('clientId', 'name email')
            .sort('-timestamp')
            .limit(100);

        res.json(logs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add investment for client
router.post('/investments', adminAuth, [
    body('clientId').notEmpty(),
    body('amount').isFloat({ min: 0 }),
    body('investmentDate').isISO8601(),
    body('type').isIn(['deposit', 'withdrawal'])
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { clientId, amount, investmentDate, type } = req.body;

        const investment = new Investment({
            clientId,
            investmentDate: new Date(investmentDate),
            amount: amount,
            type: type
        });

        await investment.save();

        // Trigger recalculation
        try {
            await InvestmentCalculator.recalculateFromDate(new Date(investmentDate));
        } catch (calcError) {
            console.error('Recalculation error:', calcError);
            // Don't fail the investment creation if recalculation fails
        }

        res.status(201).json(investment);
    } catch (error) {
        console.error('Investment creation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update monthly returns
router.post('/investments/:investmentId/returns', adminAuth, [
    body('returnPercentage').isFloat(),
    body('month').isISO8601()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { returnPercentage, month } = req.body;
        const investment = await Investment.findById(req.params.investmentId);

        if (!investment) {
            return res.status(404).json({ error: 'Investment not found' });
        }

        // Calculate trader's share (if profit is 2x%, client gets x%)
        const clientReturnPercentage = returnPercentage / 2;
        const profitAmount = investment.currentAmount * (clientReturnPercentage / 100);
        const closingAmount = investment.currentAmount + profitAmount;

        investment.monthlyReturns.push({
            month: new Date(month),
            returnPercentage: clientReturnPercentage,
            profitAmount,
            closingAmount
        });

        investment.currentAmount = closingAmount;
        await investment.save();

        res.json(investment);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Enter currency data
router.post('/currency-data', adminAuth, [
    body('platformId').notEmpty(),
    body('value').isFloat({ min: 0 }),
    body('date').isISO8601()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { platformId, value, date } = req.body;
        const dataDate = new Date(date);

        // Calculate week and year
        const week = getWeekNumber(dataDate);
        const year = dataDate.getFullYear();

        const currencyData = new CurrencyData({
            platformId,
            value,
            date: dataDate,
            week,
            year,
            enteredBy: req.user._id
        });

        await currencyData.save();
        res.status(201).json(currencyData);
    } catch (error) {
        if (error.code === 11000) {
            res.status(400).json({ error: 'Data for this platform and week already exists' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// Add endpoint to view audit logs
router.get('/audit-logs', adminAuth, async (req, res) => {
    try {
        const { clientId, action, startDate, endDate } = req.query;
        let query = {};

        if (clientId) query.clientId = clientId;
        if (action) query.action = action;
        if (startDate || endDate) {
            query.timestamp = {};
            if (startDate) query.timestamp.$gte = new Date(startDate);
            if (endDate) query.timestamp.$lte = new Date(endDate);
        }

        const logs = await AuditLog.find(query)
            .populate('adminId', 'name email')
            .populate('clientId', 'name email')
            .sort('-timestamp')
            .limit(100);

        res.json(logs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Helper function to get week number
function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// Add to src/routes/admin.js

// Edit investment endpoint
router.put('/investments/:investmentId', adminAuth, [
    body('amount').isFloat({ min: 0 }).withMessage('Amount must be positive'),
    body('reason').notEmpty().withMessage('Reason for edit is required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { amount, reason } = req.body;
        const investment = await Investment.findById(req.params.investmentId);

        if (!investment) {
            return res.status(404).json({ error: 'Investment not found' });
        }

        // Store edit history
        investment.editHistory.push({
            previousAmount: investment.amount,
            newAmount: amount,
            editedBy: req.user.id,
            reason: reason
        });

        // Update amount
        investment.amount = amount;
        investment.isEdited = true;
        await investment.save();

        // Trigger recalculation from this investment's date
        const recalcResult = await InvestmentCalculator.recalculateFromDate(
            investment.investmentDate
        );

        // Log the edit
        // Log the edit
        await AuditLog.create({
            adminId: req.user.id,
            action: 'edit_investment',
            clientId: investment.clientId,
            details: {
                investmentId: investment._id,
                previousAmount: investment.editHistory[investment.editHistory.length - 1].previousAmount,
                newAmount: amount,
                reason: reason
            },
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });

        res.json({
            message: 'Investment updated and returns recalculated',
            investment,
            recalculation: recalcResult
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add platform investment
router.post('/platform-investments', adminAuth, [
    body('platformName').notEmpty().withMessage('Platform name is required'),
    body('amount').isFloat({ min: 0 }).withMessage('Amount must be positive'),
    body('investmentDate').isISO8601().withMessage('Valid date required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { platformName, amount, investmentDate } = req.body;

        const platformInvestment = new PlatformInvestment({
            platformName,
            amount,
            investmentDate: new Date(investmentDate),
            currentValue: amount
        });

        await platformInvestment.save();

        // Recalculate from this date
        await InvestmentCalculator.recalculateFromDate(new Date(investmentDate));

        res.status(201).json({
            message: 'Platform investment added',
            platformInvestment
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update platform returns
router.put('/platform-investments/:platformId/returns', adminAuth, [
    body('returnPercentage').isFloat().withMessage('Return percentage required'),
    body('currentValue').isFloat({ min: 0 }).withMessage('Current value required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { returnPercentage, currentValue } = req.body;

        const platform = await PlatformInvestment.findById(req.params.platformId);
        if (!platform) {
            return res.status(404).json({ error: 'Platform investment not found' });
        }

        platform.returnPercentage = returnPercentage;
        platform.currentValue = currentValue;
        await platform.save();

        // Recalculate current month
        const currentMonth = new Date();
        await InvestmentCalculator.calculateMonthlyReturns(currentMonth);

        res.json({
            message: 'Platform returns updated',
            platform
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get corpus overview
router.get('/corpus/overview', adminAuth, async (req, res) => {
    try {
        const { date = new Date() } = req.query;

        // Get corpus data
        const corpusData = await InvestmentCalculator.getCorpusAtDate(new Date(date));

        // Get platform investments
        const platforms = await PlatformInvestment.find({ status: 'active' });

        // Get latest monthly return
        const latestReturn = await MonthlyReturn.findOne()
            .sort('-month')
            .populate('clientReturns.clientId', 'name email');

        res.json({
            corpus: corpusData,
            platforms,
            latestMonthlyReturn: latestReturn,
            summary: {
                totalCorpus: corpusData.totalCorpus,
                totalPlatformValue: platforms.reduce((sum, p) => sum + p.currentValue, 0),
                numberOfClients: corpusData.clientShares.length,
                numberOfPlatforms: platforms.length
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get client portfolio with proportional returns
router.get('/clients/:clientId/portfolio', adminAuth, async (req, res) => {
    try {
        const { clientId } = req.params;

        // Get all client investments
        const investments = await Investment.find({
            clientId,
            status: 'active'
        }).sort('investmentDate');

        // Get monthly returns for this client
        const monthlyReturns = await MonthlyReturn.find({
            'clientReturns.clientId': clientId
        })
            .sort('month')
            .lean();

        // Extract client-specific returns
        const clientReturns = monthlyReturns.map(mr => {
            const clientReturn = mr.clientReturns.find(
                cr => cr.clientId.toString() === clientId
            );
            return {
                month: mr.month,
                totalCorpus: mr.totalCorpus,
                sharePercentage: clientReturn.sharePercentage,
                investmentShare: clientReturn.investmentShare,
                returnAmount: clientReturn.returnAmount,
                closingBalance: clientReturn.closingBalance,
                monthlyReturnPercentage: mr.monthlyReturnPercentage
            };
        });

        // Calculate summary
        const totalInvested = investments.reduce((sum, inv) => {
            return sum + (inv.type === 'withdrawal' ? -inv.amount : inv.amount);
        }, 0);

        const currentValue = clientReturns.length > 0
            ? clientReturns[clientReturns.length - 1].closingBalance
            : totalInvested;

        const totalReturns = currentValue - totalInvested;
        const returnPercentage = totalInvested > 0
            ? ((totalReturns / totalInvested) * 100).toFixed(2)
            : 0;

        res.json({
            investments,
            monthlyReturns: clientReturns,
            summary: {
                totalInvested,
                currentValue,
                totalReturns,
                returnPercentage: parseFloat(returnPercentage)
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Continuation of admin.js routes...

// Delete investment
router.delete('/investments/:investmentId', adminAuth, async (req, res) => {
    try {
        const investment = await Investment.findById(req.params.investmentId);

        if (!investment) {
            return res.status(404).json({ error: 'Investment not found' });
        }

        // Store for recalculation
        const investmentDate = investment.investmentDate;
        const clientId = investment.clientId;

        // Soft delete by changing status
        investment.status = 'cancelled';
        await investment.save();

        // Trigger recalculation
        await InvestmentCalculator.recalculateFromDate(investmentDate);

        // Log the deletion
        await AuditLog.create({
            adminId: req.user.id,
            action: 'delete_investment',
            clientId: clientId,
            details: {
                investmentId: investment._id,
                amount: investment.amount,
                date: investmentDate
            },
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });

        res.json({
            message: 'Investment deleted and returns recalculated'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Manual recalculation trigger
router.post('/recalculate', adminAuth, [
    body('fromDate').isISO8601().withMessage('Valid date required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { fromDate } = req.body;

        // Trigger recalculation
        const result = await InvestmentCalculator.recalculateFromDate(new Date(fromDate));

        // Log the action
        await AuditLog.create({
            adminId: req.user.id,
            action: 'manual_recalculation',
            details: {
                fromDate: fromDate,
                monthsRecalculated: result.monthsRecalculated
            },
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });

        res.json({
            message: 'Recalculation completed',
            result
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get investment history with edits
router.get('/investments/history/:clientId', adminAuth, async (req, res) => {
    try {
        const { clientId } = req.params;
        const { includeEdits = true } = req.query;

        const investments = await Investment.find({
            clientId,
            ...(includeEdits ? {} : { isEdited: false })
        })
            .populate('editHistory.editedBy', 'name')
            .sort('-investmentDate');

        res.json(investments);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Bulk platform return update
router.post('/platform-investments/bulk-update', adminAuth, [
    body('updates').isArray().withMessage('Updates must be an array'),
    body('updates.*.platformId').notEmpty().withMessage('Platform ID required'),
    body('updates.*.returnPercentage').isFloat().withMessage('Return percentage required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { updates } = req.body;
        const results = [];

        for (const update of updates) {
            const platform = await PlatformInvestment.findById(update.platformId);
            if (platform) {
                platform.returnPercentage = update.returnPercentage;
                platform.currentValue = platform.amount * (1 + update.returnPercentage / 100);
                await platform.save();
                results.push({
                    platformId: platform._id,
                    platformName: platform.platformName,
                    success: true
                });
            } else {
                results.push({
                    platformId: update.platformId,
                    success: false,
                    error: 'Platform not found'
                });
            }
        }

        // Recalculate current month
        await InvestmentCalculator.calculateMonthlyReturns(new Date());

        res.json({
            message: 'Platform returns updated',
            results
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Enter weekly platform data
router.post('/platforms/weekly-data', adminAuth, [
    body('platformId').notEmpty(),
    body('weekStartDate').isISO8601(),
    body('closingValue').isFloat({ min: 0 }),
    body('notes').optional().isString()
], async (req, res) => {
    try {
        const { platformId, weekStartDate, closingValue, notes } = req.body;

        const platform = await PlatformInvestment.findById(platformId);
        if (!platform) {
            return res.status(404).json({ error: 'Platform not found' });
        }

        const startDate = new Date(weekStartDate);
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 6);

        // Get previous week's closing value as opening value
        const previousWeek = await WeeklyPlatformData.findOne({
            platformId,
            weekEndDate: { $lt: startDate }
        }).sort('-weekEndDate');

        const openingValue = previousWeek ? previousWeek.closingValue : platform.amount;
        const profitAmount = closingValue - openingValue;
        const weeklyReturn = ((closingValue - openingValue) / openingValue) * 100;

        const weeklyData = new WeeklyPlatformData({
            platformId,
            weekStartDate: startDate,
            weekEndDate: endDate,
            weekNumber: getWeekNumber(startDate),
            year: startDate.getFullYear(),
            openingValue,
            closingValue,
            weeklyReturn,
            profitAmount,
            notes,
            enteredBy: req.user.id
        });

        await weeklyData.save();

        // Update platform's current value
        platform.currentValue = closingValue;
        await platform.save();

        res.json({ message: 'Weekly data saved successfully', weeklyData });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get weekly performance overview
router.get('/platforms/weekly-performance', adminAuth, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        const query = {};
        if (startDate) query.weekStartDate = { $gte: new Date(startDate) };
        if (endDate) query.weekEndDate = { $lte: new Date(endDate) };

        const weeklyData = await WeeklyPlatformData.find(query)
            .populate('platformId', 'platformName')
            .sort('weekStartDate');

        // Group by week
        const weeklyPerformance = {};

        weeklyData.forEach(data => {
            const weekKey = data.weekStartDate.toISOString().split('T')[0];

            if (!weeklyPerformance[weekKey]) {
                weeklyPerformance[weekKey] = {
                    weekStartDate: data.weekStartDate,
                    weekEndDate: data.weekEndDate,
                    platforms: [],
                    totalOpeningValue: 0,
                    totalClosingValue: 0,
                    totalProfit: 0,
                    overallReturn: 0
                };
            }

            weeklyPerformance[weekKey].platforms.push({
                platformName: data.platformId.platformName,
                openingValue: data.openingValue,
                closingValue: data.closingValue,
                profit: data.profitAmount,
                return: data.weeklyReturn,
                isInterpolated: data.isInterpolated
            });

            weeklyPerformance[weekKey].totalOpeningValue += data.openingValue;
            weeklyPerformance[weekKey].totalClosingValue += data.closingValue;
            weeklyPerformance[weekKey].totalProfit += data.profitAmount;
        });

        // Calculate overall return for each week
        Object.values(weeklyPerformance).forEach(week => {
            week.overallReturn = ((week.totalClosingValue - week.totalOpeningValue) / week.totalOpeningValue) * 100;
        });

        res.json(Object.values(weeklyPerformance));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Calculate monthly returns from weekly data
router.post('/monthly-returns/calculate-from-weekly', adminAuth, [
    body('month').isISO8601()
], async (req, res) => {
    try {
        const { month } = req.body;
        const monthDate = new Date(month);
        const startOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
        const endOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);

        // Get all weekly data for the month
        const weeklyData = await WeeklyPlatformData.find({
            weekStartDate: { $gte: startOfMonth },
            weekEndDate: { $lte: endOfMonth }
        });

        // Handle missing weeks with interpolation
        await interpolateMissingWeeks(startOfMonth, endOfMonth);

        // Calculate aggregate monthly return
        const monthlyReturn = await calculateMonthlyReturnFromWeekly(monthDate);

        // Use the existing InvestmentCalculator
        await InvestmentCalculator.calculateMonthlyReturns(monthDate, monthlyReturn);

        res.json({
            message: 'Monthly returns calculated successfully',
            monthlyReturn,
            weeksUsed: weeklyData.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Helper function to interpolate missing weeks
async function interpolateMissingWeeks(startDate, endDate) {
    const platforms = await PlatformInvestment.find({ status: 'active' });

    for (const platform of platforms) {
        const existingWeeks = await WeeklyPlatformData.find({
            platformId: platform._id,
            weekStartDate: { $gte: startDate, $lte: endDate }
        }).sort('weekStartDate');

        // Find gaps and interpolate
        let currentWeek = new Date(startDate);
        while (currentWeek <= endDate) {
            const weekExists = existingWeeks.some(w =>
                w.weekStartDate.toDateString() === currentWeek.toDateString()
            );

            if (!weekExists) {
                // Find surrounding weeks for interpolation
                const before = await WeeklyPlatformData.findOne({
                    platformId: platform._id,
                    weekEndDate: { $lt: currentWeek }
                }).sort('-weekEndDate');

                const after = await WeeklyPlatformData.findOne({
                    platformId: platform._id,
                    weekStartDate: { $gt: currentWeek }
                }).sort('weekStartDate');

                if (before && after) {
                    // Linear interpolation
                    const weeksBetween = Math.ceil((after.weekStartDate - before.weekEndDate) / (7 * 24 * 60 * 60 * 1000));
                    const valueChange = after.openingValue - before.closingValue;
                    const changePerWeek = valueChange / weeksBetween;

                    const interpolatedValue = before.closingValue + changePerWeek;

                    await WeeklyPlatformData.create({
                        platformId: platform._id,
                        weekStartDate: currentWeek,
                        weekEndDate: new Date(currentWeek.getTime() + 6 * 24 * 60 * 60 * 1000),
                        weekNumber: getWeekNumber(currentWeek),
                        year: currentWeek.getFullYear(),
                        openingValue: before.closingValue,
                        closingValue: interpolatedValue,
                        weeklyReturn: ((interpolatedValue - before.closingValue) / before.closingValue) * 100,
                        profitAmount: interpolatedValue - before.closingValue,
                        isInterpolated: true,
                        notes: 'Auto-interpolated'
                    });
                }
            }

            currentWeek.setDate(currentWeek.getDate() + 7);
        }
    }
}

// Calculate monthly return from weekly data
async function calculateMonthlyReturnFromWeekly(monthDate) {
    const startOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const endOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);

    const platforms = await PlatformInvestment.find({ status: 'active' });
    let totalMonthStart = 0;
    let totalMonthEnd = 0;

    for (const platform of platforms) {
        // Get first week of month
        const firstWeek = await WeeklyPlatformData.findOne({
            platformId: platform._id,
            weekStartDate: { $gte: startOfMonth }
        }).sort('weekStartDate');

        // Get last week of month
        const lastWeek = await WeeklyPlatformData.findOne({
            platformId: platform._id,
            weekEndDate: { $lte: endOfMonth }
        }).sort('-weekEndDate');

        if (firstWeek && lastWeek) {
            totalMonthStart += firstWeek.openingValue;
            totalMonthEnd += lastWeek.closingValue;
        }
    }

    return ((totalMonthEnd - totalMonthStart) / totalMonthStart) * 100;
}

// Get recent monthly returns
router.get('/monthly-returns/recent', adminAuth, async (req, res) => {
    try {
        const recentReturns = await MonthlyReturn.find()
            .sort('-month')
            .limit(12) // Last 12 months
            .select('month totalCorpus monthlyReturnPercentage clientReturns calculatedAt');

        // Calculate total returns for each month
        const returnsWithTotals = recentReturns.map(monthReturn => {
            const totalReturns = monthReturn.clientReturns.reduce(
                (sum, client) => sum + client.returnAmount,
                0
            );

            return {
                ...monthReturn.toObject(),
                totalReturns
            };
        });

        res.json(returnsWithTotals);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;