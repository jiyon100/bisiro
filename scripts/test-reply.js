require('dotenv').config();
const { getReply } = require('../src/ai/replyEngine');

const SAMPLES = [
  {
    label: 'Sari-sari store — Tagalog inquiry',
    agentConfig: {
      system_prompt: `You are the AI assistant for Aling Nena's Sari-Sari Store, a neighborhood convenience store in Quezon City.
Products: basic groceries, canned goods, snacks, softdrinks, load (Globe/TM/Smart), basic medicines (biogesic, neozep).
Tone: warm, friendly, and using natural Taglish like a trusted neighbor would.
Hours: 6am–10pm daily.
FAQs: Do you have [item]? How much is [item]? Mayroon bang load?
Never promise: exact delivery times, items not listed, credit (utang) to strangers.
Escalate to owner if customer asks about bulk orders or something you're unsure of.`,
    },
    history: [],
    message: 'Ate, mayroon ba kayong Biogesic? Magkano?',
  },
  {
    label: 'Home bakery — English closing signal',
    agentConfig: {
      system_prompt: `You are the AI assistant for Sweet by Cath, a home-based custom cake and pastry business in Manila.
Products: custom birthday cakes (₱800–₱3,500), cupcakes (₱45–₱65 each, min order 12), brownies, cheesecakes.
Tone: cheerful, sweet, and professional. Use "po" naturally.
Lead time: minimum 3 days for custom cakes, 1 day for cupcakes.
Hours: orders accepted Mon–Sat 9am–6pm. Closed Sunday.
FAQs: How much is a cake for [X] persons? What flavors? How do I order?
Never quote exact delivery time on the same day, never accept orders under the minimum lead time.
Escalate to owner (Cath) for: bulk event orders (50+ cupcakes), wedding cakes, corporate orders.`,
    },
    history: [
      { role: 'user', content: 'Hi! How much for a birthday cake for 20 persons?' },
      { role: 'assistant', content: '{"reply":"Hi po! For 20 persons, our cakes range from ₱1,200 to ₱2,000 depending on design and flavor. What theme or flavors are you considering? 🎂","status":"ongoing"}' },
    ],
    message: 'Chocolate with strawberry toppings. Gusto ko yung ₱1,500 range. Pano mag-order?',
  },
  {
    label: 'Laundry shop — spam detection',
    agentConfig: {
      system_prompt: `You are the AI assistant for QuickWash Laundry Shop in Makati.
Services: wash & dry (₱65/kg, min 3kg), wash & fold (₱80/kg), express service (+₱30/kg, done in 3hrs).
Hours: Mon–Sat 7am–8pm, Sun 8am–5pm.
Tone: professional and efficient.
Never promise: same-day service without confirming availability, pickup/delivery (walk-in only for now).
Escalate to owner for: bulk/commercial laundry, monthly service contracts.`,
    },
    history: [],
    message: 'PROMO PROMO PROMO! Earn ₱5,000 daily working from home! Click here: bit.ly/scam123',
  },
  {
    label: 'Online clothing shop — Taglish mixed inquiry',
    agentConfig: {
      system_prompt: `You are the AI assistant for CTRL+Style, an online clothing shop based in Cebu selling trendy affordable streetwear.
Products: oversized tees (₱299–₱399), joggers (₱450–₱550), caps (₱199), hoodies (₱699–₱850). Sizes XS–3XL.
Shipping: nationwide via J&T and LBC, 3–7 days. COD available for orders ₱500+.
Tone: youthful, casual, and energetic. Gen Z Taglish is fine.
FAQs: Available sizes? May COD ba? Ilang araw delivery? Paano mag-order?
Never promise exact delivery dates, never accept GCash from unverified buyers without order confirmation first.
Escalate to owner for: bulk/wholesale inquiries, custom prints, returns/exchange issues.`,
    },
    history: [],
    message: 'Uy may XL ba yung black oversized tee? COD pwede? Nasa Cebu ako',
  },
];

async function run() {
  console.log('=== Bisiro Reply Engine Test ===\n');

  for (const sample of SAMPLES) {
    console.log(`--- ${sample.label} ---`);
    console.log(`Customer: "${sample.message}"`);
    try {
      const result = await getReply(sample.agentConfig, sample.history, sample.message);
      console.log(`Reply:    "${result.reply}"`);
      console.log(`Status:   ${result.status}`);
      console.log(`Tokens:   ${result.inputTokens} in / ${result.outputTokens} out`);
      console.log(`Cost:     ₱${result.costPhp} (USD $${result.costUsd})`);
    } catch (err) {
      console.error(`ERROR: ${err.message}`);
    }
    console.log();
  }
}

run();
