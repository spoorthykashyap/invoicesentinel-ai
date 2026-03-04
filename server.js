const express = require('express');
const path = require('path');
const multer = require('multer');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Static files (frontend)
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Multer config for simulated uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// --- Sample Data & Validation Engine ---

const rateCard = {
  logistics: {
    'Route Linehaul Charge': 95,
    'Last-Mile Delivery': 50,
    'Fuel Surcharge': 0
  },
  rawMaterials: {
    'Steel Coils': 720,
    'Aluminium Sheets': 540
  },
  marketing: {
    'Retainer Fee': 5000,
    'Campaign Management': 1200
  }
};

const expectedGstByCategory = {
  logistics: 18,
  rawMaterials: 18,
  marketing: 18
};

const historicalInvoices = [
  { invoiceNumber: 'LOG-2024-001', vendorName: 'BlueLine Logistics' },
  { invoiceNumber: 'RM-2024-008', vendorName: 'Prime Metals Co.' },
  { invoiceNumber: 'MKT-2024-015', vendorName: 'GrowthGrid Agency' }
];

const sampleInvoices = [
  {
    id: 'logistics-1',
    category: 'logistics',
    vendorName: 'BlueLine Logistics',
    invoiceNumber: 'LOG-2024-001',
    invoiceDate: '2024-11-05',
    gstRate: 18,
    hsnCode: '996511',
    lineItems: [
      {
        description: 'Route Linehaul Charge',
        quantity: 100,
        rate: 110,
        total: 11000
      },
      {
        description: 'Last-Mile Delivery',
        quantity: 80,
        rate: 50,
        total: 4000
      },
      {
        description: 'Fuel Surcharge',
        quantity: 1,
        rate: 1500,
        total: 1500
      }
    ]
  },
  {
    id: 'raw-1',
    category: 'rawMaterials',
    vendorName: 'Prime Metals Co.',
    invoiceNumber: 'RM-2024-008',
    invoiceDate: '2024-10-18',
    gstRate: 12,
    hsnCode: '720827',
    lineItems: [
      {
        description: 'Steel Coils',
        quantity: 15,
        rate: 720,
        total: 10800
      },
      {
        description: 'Aluminium Sheets',
        quantity: 20,
        rate: 540,
        total: 10800
      }
    ]
  },
  {
    id: 'marketing-1',
    category: 'marketing',
    vendorName: 'GrowthGrid Agency',
    invoiceNumber: 'MKT-2024-015',
    invoiceDate: '2024-09-30',
    gstRate: 18,
    hsnCode: '998361',
    lineItems: [
      {
        description: 'Retainer Fee',
        quantity: 1,
        rate: 5000,
        total: 5000
      },
      {
        description: 'Campaign Management',
        quantity: 10,
        rate: 1300,
        total: 13000
      },
      {
        description: 'Performance Bonus Surcharge',
        quantity: 1,
        rate: 2500,
        total: 2500
      }
    ]
  }
];

const processedStats = {
  totalInvoicesProcessed: 0,
  totalInvoiceAmount: 0,
  totalCorrectAmount: 0,
  totalOvercharge: 0,
  discrepancyTypeCounts: {
    OVERCHARGE: 0,
    GST_MISMATCH: 0,
    DUPLICATE: 0,
    UNAPPROVED_CHARGE: 0,
    CALCULATION_ERROR: 0,
    OK: 0
  },
  vendorRisk: {}
};

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function validateInvoice(invoice) {
  const category = invoice.category;
  const categoryRates = rateCard[category] || {};
  const expectedGst = expectedGstByCategory[category] ?? invoice.gstRate;

  let totalInvoiceAmount = 0;
  let correctAmount = 0;
  let totalOvercharge = 0;

  const discrepancyTypesForInvoice = new Set();

  const lineResults = invoice.lineItems.map((item) => {
    const approvedRate = categoryRates[item.description];
    const chargedRate = item.rate;
    const expectedTotal = item.quantity * chargedRate;
    const calcError = expectedTotal !== item.total;

    totalInvoiceAmount += item.total;

    let status = 'OK';
    let discrepancyType = 'OK';
    let difference = 0;

    if (approvedRate == null) {
      status = 'UNAPPROVED_CHARGE';
      discrepancyType = 'UNAPPROVED_CHARGE';
      discrepancyTypesForInvoice.add(discrepancyType);
      processedStats.discrepancyTypeCounts.UNAPPROVED_CHARGE += 1;
      correctAmount += 0;
      totalOvercharge += item.total;
      difference = item.total;
    } else {
      if (chargedRate > approvedRate) {
        status = 'OVERCHARGE';
        discrepancyType = 'OVERCHARGE';
        difference = (chargedRate - approvedRate) * item.quantity;
        discrepancyTypesForInvoice.add(discrepancyType);
        processedStats.discrepancyTypeCounts.OVERCHARGE += 1;
      }
      correctAmount += approvedRate * item.quantity;
      totalOvercharge += difference;
      if (difference === 0 && !calcError) {
        processedStats.discrepancyTypeCounts.OK += 1;
      }
    }

    if (calcError) {
      discrepancyTypesForInvoice.add('CALCULATION_ERROR');
      processedStats.discrepancyTypeCounts.CALCULATION_ERROR += 1;
      if (status === 'OK') {
        status = 'CALCULATION_ERROR';
        discrepancyType = 'CALCULATION_ERROR';
      }
    }

    return {
      description: item.description,
      quantity: item.quantity,
      approvedRate: approvedRate ?? null,
      chargedRate,
      difference,
      total: item.total,
      status,
      discrepancyType
    };
  });

  const duplicate = historicalInvoices.some(
    (h) => h.invoiceNumber === invoice.invoiceNumber
  );

  let gstMismatch = false;
  if (invoice.gstRate !== expectedGst) {
    gstMismatch = true;
    discrepancyTypesForInvoice.add('GST_MISMATCH');
    processedStats.discrepancyTypeCounts.GST_MISMATCH += 1;
  }

  if (duplicate) {
    discrepancyTypesForInvoice.add('DUPLICATE');
    processedStats.discrepancyTypeCounts.DUPLICATE += 1;
  }

  const leakagePercent =
    totalInvoiceAmount === 0
      ? 0
      : parseFloat(((totalOvercharge / totalInvoiceAmount) * 100).toFixed(2));

  let riskLevel = 'Low';
  if (leakagePercent >= 10 || duplicate) riskLevel = 'Critical';
  else if (leakagePercent >= 5 || gstMismatch) riskLevel = 'Medium';

  processedStats.totalInvoicesProcessed += 1;
  processedStats.totalInvoiceAmount += totalInvoiceAmount;
  processedStats.totalCorrectAmount += correctAmount;
  processedStats.totalOvercharge += totalOvercharge;

  const vendorKey = invoice.vendorName;
  if (!processedStats.vendorRisk[vendorKey]) {
    processedStats.vendorRisk[vendorKey] = {
      totalInvoices: 0,
      totalOvercharge: 0,
      leakagePercent: 0,
      riskLevel: 'Low'
    };
  }
  const v = processedStats.vendorRisk[vendorKey];
  v.totalInvoices += 1;
  v.totalOvercharge += totalOvercharge;
  v.leakagePercent = leakagePercent;
  v.riskLevel = riskLevel;

  return {
    invoice,
    lineResults,
    totalInvoiceAmount,
    correctAmount,
    totalOvercharge,
    leakagePercent,
    gstMismatch,
    duplicate,
    riskLevel,
    discrepancyTypes: Array.from(discrepancyTypesForInvoice)
  };
}

// Pre-process sample invoices into dashboard stats
sampleInvoices.forEach((inv) => validateInvoice(clone(inv)));

// --- API Routes ---

app.get('/api/dashboard', (req, res) => {
  const { totalInvoicesProcessed, totalInvoiceAmount, totalCorrectAmount, totalOvercharge, discrepancyTypeCounts, vendorRisk } =
    processedStats;

  const billedVsCorrect = {
    labels: ['Billed Amount', 'Correct Amount'],
    data: [totalInvoiceAmount, totalCorrectAmount]
  };

  const discrepancyBreakdown = {
    labels: Object.keys(discrepancyTypeCounts),
    data: Object.values(discrepancyTypeCounts)
  };

  const vendorRiskChart = {
    labels: Object.keys(vendorRisk),
    data: Object.values(vendorRisk).map((v) => v.leakagePercent)
  };

  res.json({
    totals: {
      totalInvoicesProcessed,
      totalInvoiceAmount,
      totalCorrectAmount,
      totalOvercharge
    },
    charts: {
      billedVsCorrect,
      discrepancyBreakdown,
      vendorRisk: vendorRiskChart
    }
  });
});

app.get('/api/invoices/samples', (req, res) => {
  res.json(
    sampleInvoices.map((s) => ({
      id: s.id,
      vendorName: s.vendorName,
      invoiceNumber: s.invoiceNumber,
      category: s.category
    }))
  );
});

app.post('/api/invoices/use-sample/:id', (req, res) => {
  const id = req.params.id;
  const sample = sampleInvoices.find((s) => s.id === id);
  if (!sample) {
    return res.status(404).json({ error: 'Sample not found' });
  }

  const validation = validateInvoice(clone(sample));
  res.json({
    extractionAccuracy: 96,
    ...validation
  });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  const simulationId = req.body.simulationId || 'logistics-1';
  const sample = sampleInvoices.find((s) => s.id === simulationId) || sampleInvoices[0];
  const validation = validateInvoice(clone(sample));

  res.json({
    extractionAccuracy: 96,
    ...validation,
    uploadedFileName: req.file ? req.file.originalname : null
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`InvoiceSentinel AI server running at http://localhost:${port}`);
});

