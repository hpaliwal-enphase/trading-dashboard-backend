const express = require('express');
const Investment = require('../models/Investment');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Get client dashboard data
router.get('/dashboard', auth, async (req, res) => {
  try {
    if (req.user.role !== 'client') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const investments = await Investment.find({ 
      clientId: req.user._id,
      status: 'active'
    });

    const totalInvestment = investments.reduce((sum, inv) => sum + inv.initialAmount, 0);
    const currentValue = investments.reduce((sum, inv) => sum + inv.currentAmount, 0);
    const totalReturn = totalInvestment > 0 ? ((currentValue - totalInvestment) / totalInvestment * 100) : 0;

    // Prepare monthly returns data for charts
    const monthlyData = [];
    investments.forEach(inv => {
      inv.monthlyReturns.forEach(ret => {
        const monthKey = ret.month.toISOString().slice(0, 7);
        const existing = monthlyData.find(m => m.month === monthKey);
        if (existing) {
          existing.profit += ret.profitAmount;
        } else {
          monthlyData.push({
            month: monthKey,
            profit: ret.profitAmount,
            returnPercentage: ret.returnPercentage
          });
        }
      });
    });

    res.json({
      summary: {
        totalInvestment,
        currentValue,
        totalReturn: totalReturn.toFixed(2),
        totalProfit: currentValue - totalInvestment
      },
      investments,
      monthlyData: monthlyData.sort((a, b) => a.month.localeCompare(b.month))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get investment details
router.get('/investments', auth, async (req, res) => {
  try {
    if (req.user.role !== 'client') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const investments = await Investment.find({ 
      clientId: req.user._id 
    }).sort('-investmentDate');

    const investmentDetails = investments.map(inv => ({
      id: inv._id,
      investmentDate: inv.investmentDate,
      initialAmount: inv.initialAmount,
      currentAmount: inv.currentAmount,
      status: inv.status,
      percentageChange: ((inv.currentAmount - inv.initialAmount) / inv.initialAmount * 100).toFixed(2),
      totalChange: inv.currentAmount - inv.initialAmount,
      monthlyReturns: inv.monthlyReturns
    }));

    res.json(investmentDetails);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;