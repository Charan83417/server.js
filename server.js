const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const app = express();
const port = 3000;
const { v4: uuidv4 } = require('uuid');

// Middleware
app.use(cors());
app.use(bodyParser.json());

// In-memory database
let users = []; // All users
let referrals = []; // Referral records
let wallets = {}; // userId => { balance, transactions }
let withdrawals = {}; // userId => [timestamps]

// Utility functions
function rewardUser(userId, amount) {
  if (!wallets[userId]) {
    wallets[userId] = { balance: 0, transactions: [] };
  }
  wallets[userId].balance += amount;
  wallets[userId].transactions.push({ type: 'credit', amount, date: new Date().toISOString() });
}

function withdrawUser(userId, amount) {
  if (!wallets[userId] || wallets[userId].balance < amount) return false;
  wallets[userId].balance -= amount;
  wallets[userId].transactions.push({ type: 'debit', amount, date: new Date().toISOString() });
  return true;
}

function canWithdraw(userId, type) {
  const today = new Date().toISOString().split('T')[0];
  if (!withdrawals[userId]) withdrawals[userId] = [];
  const todayWithdrawals = withdrawals[userId].filter(t => t.startsWith(today));
  if (type === 'customer') return todayWithdrawals.length < 1;
  if (type === 'vendor') return todayWithdrawals.length < 3;
  return false;
}

function logWithdraw(userId) {
  if (!withdrawals[userId]) withdrawals[userId] = [];
  withdrawals[userId].push(new Date().toISOString());
}

// Register user (customer/vendor)
app.post('/register', (req, res) => {
  const { type, name, phone } = req.body;
  const id = uuidv4();
  users.push({ id, type, name, phone });
  wallets[id] = { balance: 0, transactions: [] };
  res.json({ id, message: `${type} registered successfully` });
});

// Start referral
app.post('/initiate-referral', (req, res) => {
  const { customerId, vendorName, vendorLocation } = req.body;
  const vendorId = uuidv4();
  referrals.push({ vendorId, customerId, vendorName, vendorLocation, status: 'initiated', createdAt: new Date().toISOString() });
  res.json({ vendorId, message: 'Referral initiated' });
});

// Vendor completes registration
app.post('/vendor-register', (req, res) => {
  const { vendorId, vendorDetails, agreementAccepted } = req.body;
  const referral = referrals.find(r => r.vendorId === vendorId);
  if (!referral) return res.status(404).json({ error: 'Referral not found' });

  users.push({ id: vendorId, type: 'vendor', ...vendorDetails });
  referral.status = 'registered';
  referral.agreement = agreementAccepted;

  rewardUser(referral.customerId, 120);
  rewardUser(vendorId, 120);

  res.json({ message: 'Vendor registered and both rewarded' });
});

// Get wallet info
app.get('/wallet/:userId', (req, res) => {
  const userId = req.params.userId;
  res.json(wallets[userId] || { balance: 0, transactions: [] });
});

// Withdraw
app.post('/withdraw', (req, res) => {
  const { userId, amount } = req.body;
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!canWithdraw(userId, user.type)) return res.status(403).json({ error: 'Withdraw limit reached' });

  const minAmount = user.type === 'customer' ? 120 : 0;
  if (amount < minAmount) return res.status(400).json({ error: `Minimum withdraw for ${user.type} is ₹${minAmount}` });

  if (!withdrawUser(userId, amount)) return res.status(400).json({ error: 'Insufficient balance' });

  logWithdraw(userId);
  res.json({ message: 'Withdraw successful', balance: wallets[userId].balance });
});

// EOD Auto Withdraw
app.post('/eod-auto-withdraw', (req, res) => {
  users.forEach(user => {
    const uid = user.id;
    if (wallets[uid]?.balance > 0 && canWithdraw(uid, user.type)) {
      withdrawUser(uid, wallets[uid].balance);
      logWithdraw(uid);
    }
  });
  res.json({ message: 'EOD auto withdrawal completed' });
});

app.listen(port, () => {
  console.log(`✅ WeworkIndia backend running on http://localhost:${port}`);
});
