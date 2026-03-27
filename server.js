require("dotenv").config({ override: true });
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(express.json({ limit: "15mb" }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const JWT_SECRET = process.env.JWT_SECRET || "fridgely_dev_secret_change_in_prod";

/* ── Email Transporter ── */
const mailer = nodemailer.createTransport({
  host:   process.env.EMAIL_HOST || "smtp.gmail.com",
  port:   parseInt(process.env.EMAIL_PORT || "587"),
  secure: process.env.EMAIL_SECURE === "true",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const FROM_NAME  = process.env.EMAIL_FROM_NAME  || "Fridgely";
const FROM_EMAIL = process.env.EMAIL_FROM_EMAIL || process.env.EMAIL_USER || "noreply@fridgely.app";
const APP_URL    = process.env.APP_URL || "http://localhost:3000";

async function sendMail({ to, subject, html }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn("⚠️  Email not configured — skipping send to", to);
    return;
  }
  await mailer.sendMail({ from: `"${FROM_NAME}" <${FROM_EMAIL}>`, to, subject, html });
}

/* ── Email Templates ── */
const welcomeEmail = (name) => `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#0d0f0a;color:#f9fafb;border-radius:12px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#4a7a3a,#5a7c4a);padding:32px 40px;text-align:center">
    <h1 style="margin:0;font-size:28px;letter-spacing:-0.5px">🥬 Fridgely</h1>
    <p style="margin:6px 0 0;opacity:0.8;font-size:14px">Cook what you've got.</p>
  </div>
  <div style="padding:40px">
    <h2 style="color:#a8c298;margin-top:0">Welcome, ${name}! 👋</h2>
    <p style="color:#d1d5db;line-height:1.7">Your Fridgely account is all set. Here's what you can do right now:</p>
    <ul style="color:#d1d5db;line-height:2;padding-left:20px">
      <li>🧺 <strong>Add pantry items</strong> — tell Fridgely what's in your fridge</li>
      <li>🍳 <strong>Generate AI recipes</strong> — get personalised meal ideas instantly</li>
      <li>📅 <strong>Plan your week</strong> — organise meals across Monday–Friday</li>
      <li>🛒 <strong>Build a grocery list</strong> — never forget an ingredient again</li>
      <li>⭐ <strong>Save favourite recipes</strong> — your personal cookbook, always synced</li>
    </ul>
    <div style="text-align:center;margin:36px 0 0">
      <a href="${APP_URL}" style="background:linear-gradient(135deg,#5a7c4a,#4a6a3a);color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:700;font-size:15px">Open Fridgely →</a>
    </div>
  </div>
  <div style="padding:24px 40px;text-align:center;border-top:1px solid rgba(255,255,255,0.08)">
    <p style="color:#6b7280;font-size:12px;margin:0">You're receiving this because you created an account at Fridgely.<br/>If this wasn't you, you can safely ignore this email.</p>
  </div>
</div>`;

const resetEmail = (name, resetUrl) => `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#0d0f0a;color:#f9fafb;border-radius:12px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#4a7a3a,#5a7c4a);padding:32px 40px;text-align:center">
    <h1 style="margin:0;font-size:28px;letter-spacing:-0.5px">🥬 Fridgely</h1>
    <p style="margin:6px 0 0;opacity:0.8;font-size:14px">Cook what you've got.</p>
  </div>
  <div style="padding:40px">
    <h2 style="color:#a8c298;margin-top:0">Reset your password</h2>
    <p style="color:#d1d5db;line-height:1.7">Hi ${name}, we received a request to reset your Fridgely password. Click the button below — this link expires in <strong>1 hour</strong>.</p>
    <div style="text-align:center;margin:36px 0">
      <a href="${resetUrl}" style="background:linear-gradient(135deg,#5a7c4a,#4a6a3a);color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:700;font-size:15px">Reset Password →</a>
    </div>
    <p style="color:#6b7280;font-size:13px">Or paste this link into your browser:<br/><span style="color:#a8c298;word-break:break-all">${resetUrl}</span></p>
  </div>
  <div style="padding:24px 40px;text-align:center;border-top:1px solid rgba(255,255,255,0.08)">
    <p style="color:#6b7280;font-size:12px;margin:0">If you didn't request a password reset, you can safely ignore this email.</p>
  </div>
</div>`;

/* ── MongoDB ── */
mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/fridgely")
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB error:", err));

/* ── User Schema ── */
const userSchema = new mongoose.Schema({
  name:                 { type: String, required: true, trim: true },
  username:             { type: String, required: true, unique: true, lowercase: true, trim: true },
  email:                { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:             { type: String, required: true },
  resetPasswordToken:   { type: String, default: null },
  resetPasswordExpires: { type: Date,   default: null },
  pantryItems:  [{ name: String, qty: String, unit: String, inStock: Boolean }],
  savedRecipes: [mongoose.Schema.Types.Mixed],
  groceryList:  [{ name: String, qty: String, unit: String, addedFrom: String }],
  recipeHistory:[{ title: String, viewedAt: String, viewCount: Number, firstViewedAt: String }],
  recipeRatings:{ type: Map, of: Number, default: new Map() },
  recipeNotes:  { type: Map, of: String, default: new Map() },
  language:     { type: String, default: "English" },
  pageActivity: [{ page: String, timestamp: { type: Date, default: Date.now } }],
}, { timestamps: true });

userSchema.pre("save", async function() {
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, 12);
  }
});

const User = mongoose.model("User", userSchema);

/* ── RecipeRating Schema (community ratings) ── */
const recipeRatingSchema = new mongoose.Schema({
  recipe: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  rating: { type: Number, min: 1, max: 5, required: true },
}, { timestamps: true });
recipeRatingSchema.index({ recipe: 1, userId: 1 }, { unique: true });
const RecipeRating = mongoose.model("RecipeRating", recipeRatingSchema);

/* ── Auth Middleware ── */
const auth = async (req, res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = await User.findById(decoded.id).select("-password");
    if (!req.user) return res.status(401).json({ error: "User not found" });
    next();
  } catch { res.status(401).json({ error: "Invalid or expired token" }); }
};

const genToken = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: "30d" });

const serializeUser = (u) => ({
  id: u._id, name: u.name, username: u.username, email: u.email,
  pantryItems:   u.pantryItems  || [],
  savedRecipes:  u.savedRecipes || [],
  groceryList:   u.groceryList  || [],
  recipeHistory: u.recipeHistory|| [],
  recipeRatings: Object.fromEntries(u.recipeRatings || new Map()),
  recipeNotes:   Object.fromEntries(u.recipeNotes   || new Map()),
  language:      u.language || "English",
});
/* ── Cache ── */
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 10;
const setCache = (key, data) => cache.set(key, { data, expiry: Date.now() + CACHE_TTL });
const getCache = (key) => {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiry) { cache.delete(key); return null; }
  return item.data;
};

/* ── Retry ── */
async function withRetry(fn, retries = 2) {
  try { return await fn(); }
  catch (err) { if (retries === 0) throw err; return withRetry(fn, retries - 1); }
}

/* ── Helpers ── */
const formatIngredient = (ing) => [ing.qty, ing.unit, ing.name].filter(Boolean).join(" ");

function buildFilterLines(filters = {}) {
  const lines = [];
  if (filters.cuisine?.length)
    lines.push(`- Cuisine style (MUST match): ${filters.cuisine.join(", ")}`);
  if (filters.foodTypes?.length)
    lines.push(`- Meal types to use: ${filters.foodTypes.join(", ")}`);
  if (filters.diet?.length)
    lines.push(`- Must satisfy ALL dietary requirements: ${filters.diet.join(", ")}`);
  if (filters.difficulty)
    lines.push(`- Difficulty: ALL recipes MUST be strictly ${filters.difficulty}. Easy=<20min/minimal steps. Medium=~30min. Hard=advanced.`);
  return lines.length ? lines.join("\n") : null;
}

const buildLanguageLine = (language) => {
  if (!language || language === "English") return "";
  return `
##LANGUAGE RULE — NON-NEGOTIABLE##
You MUST write ALL output text in ${language}. This is mandatory.
This includes: overview, step descriptions, notes, tips, ingredient names (translated naturally), previews, filter_notes, and any other descriptive content.
Do NOT write any descriptive text in English. Translate everything naturally into ${language}.
ONLY the JSON keys themselves (like "overview", "steps", "name", "text") must remain in English — their VALUES must be in ${language}.
If you respond in English when ${language} is required, your response will be rejected.
##END LANGUAGE RULE##
`;
};

const normalizeStrict = (r, i) => ({ id: i, title: r?.title || "Untitled", preview: r?.preview || "" });
const normalizeFlexible = (r, i) => ({
  id: i, title: r?.title || "Untitled", preview: r?.preview || "",
  missing_ingredients: (r?.missing_ingredients || []).map(m => ({ name: m.name || "", qty: m.qty || "", unit: m.unit || "" })),
});

/* ── Pexels Image Proxy ── */
app.get("/image", async (req, res) => {
  try {
    const query = (req.query.q || "food").trim();
    const cacheKey = `img:${query.toLowerCase()}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) return res.json({ url: cached.data });

    const pexelsKey = process.env.PEXELS_API_KEY;
    if (!pexelsKey) return res.status(500).json({ error: "PEXELS_API_KEY not set" });

    const r = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query + " food dish")}&per_page=5&orientation=landscape`,
      { headers: { Authorization: pexelsKey } }
    );
    if (!r.ok) return res.status(502).json({ error: "Pexels failed" });
    const data = await r.json();
    const url = (data.photos || [])[0]?.src.large || null;
    if (url) cache.set(cacheKey, { data: url, expiry: Date.now() + 1000 * 60 * 60 * 24 });
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: "Image fetch failed" });
  }
});

/* ── Identify Ingredients from Image ── */
app.post("/identify-image", async (req, res) => {
  try {
    const { base64, mimeType = "image/jpeg" } = req.body;
    if (!base64) return res.status(400).json({ error: "No image data" });

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
          { type: "text", text: `Identify all visible food ingredients in this image. Estimate quantities if visible.

RETURN VALID JSON ONLY:
{
  "ingredients": [
    { "name": "eggs", "qty": "4", "unit": "piece" },
    { "name": "tomatoes", "qty": "2", "unit": "piece" }
  ],
  "description": "Brief one-sentence description of what you see"
}` }
        ]
      }],
      max_tokens: 600,
    });

    const text = response.choices[0].message.content.replace(/```json|```/g, "").trim();
    const data = JSON.parse(text);
    res.json(data);
  } catch (err) {
    console.error("Image identify:", err);
    res.status(500).json({ error: "Failed to identify ingredients" });
  }
});

/* ── Health ── */
app.get("/", (req, res) => res.send("✅ ChefMind API running"));

/* ── Generate Recipes ── */
app.post("/generate-recipes", async (req, res) => {
  try {
    const { ingredients = [], filters = {}, language = "English" } = req.body;
    if (!ingredients.length) return res.status(400).json({ error: "No ingredients" });

    const formattedIngredients = ingredients.map(formatIngredient).join(", ");
    const cacheKey = `recipes:${formattedIngredients}:${JSON.stringify({ ...filters, language })}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const filterLines = buildFilterLines(filters);
    const filterBlock = filterLines ? `\nFILTER CONSTRAINTS:\n${filterLines}\n` : "";
    const langLine = buildLanguageLine(language);
    const systemMsg = `You are a professional chef generating recipe suggestions.${langLine}`;

    const prompt = `${filterBlock}
=== SECTION 1: STRICT RECIPES (exactly 3) ===
- Use ONLY listed ingredients. No substitutions or additions.${filterLines ? "\n- Must satisfy every filter above." : ""}

=== SECTION 2: FLEXIBLE RECIPES (exactly 3) ===
- Use listed as BASE. May add extras (list in missing_ingredients).${filterLines ? "\n- Must satisfy every filter above." : ""}

Available: ${formattedIngredients}
No duplicate titles. 1-line preview each.

RETURN VALID JSON ONLY:
{
  "strict": [{ "title": "", "preview": "" }],
  "flexible": [{ "title": "", "preview": "", "missing_ingredients": [{ "name": "", "qty": "", "unit": "" }] }]
}`;

    const response = await withRetry(() =>
      openai.chat.completions.create({
        model: "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: prompt },
        ],
      })
    );

    const data = JSON.parse(response.choices[0].message.content);
    const result = {
      strict: (data.strict || []).map(normalizeStrict),
      flexible: (data.flexible || []).map(normalizeFlexible),
    };
    setCache(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate recipes" });
  }
});

/* ── Generate Meal Plan ── */
app.post("/generate-meal-plan", async (req, res) => {
  try {
    const { ingredients = [], filters = {}, mode = "pantry", language = "English" } = req.body;
    if (!ingredients.length) return res.status(400).json({ error: "No ingredients" });

    const formattedIngredients = ingredients.map(formatIngredient).join(", ");
    const cacheKey = `mealplan:${mode}:${formattedIngredients}:${JSON.stringify({ ...filters, language })}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const filterLines = buildFilterLines(filters);
    const filterBlock = filterLines ? `\nFILTER CONSTRAINTS:\n${filterLines}\n` : "";
    const langLine = buildLanguageLine(language);
    const systemMsg = `You are a professional meal planner.${langLine}`;

    const ingredientRules = mode === "pantry"
      ? `STRICT RULES: Use ONLY: ${formattedIngredients}. No assumptions, no staples unless listed.`
      : `GROCERY RULES: Full haul: ${formattedIngredients}. Distribute across 5 days, maximize variety. Basic staples (salt, oil) assumed available.`;

    const prompt = `${ingredientRules}
${filterBlock}
Create a 5-day meal plan (Mon-Fri), 4 meals/day (Breakfast, Lunch, Dinner, Snack).
Each meal: a name + 1-line note.

RETURN VALID JSON ONLY:
{
  "plan": [
    { "day": "Monday",    "meals": { "Breakfast": { "name": "", "note": "" }, "Lunch": { "name": "", "note": "" }, "Dinner": { "name": "", "note": "" }, "Snack": { "name": "", "note": "" } } },
    { "day": "Tuesday",   "meals": { "Breakfast": { "name": "", "note": "" }, "Lunch": { "name": "", "note": "" }, "Dinner": { "name": "", "note": "" }, "Snack": { "name": "", "note": "" } } },
    { "day": "Wednesday", "meals": { "Breakfast": { "name": "", "note": "" }, "Lunch": { "name": "", "note": "" }, "Dinner": { "name": "", "note": "" }, "Snack": { "name": "", "note": "" } } },
    { "day": "Thursday",  "meals": { "Breakfast": { "name": "", "note": "" }, "Lunch": { "name": "", "note": "" }, "Dinner": { "name": "", "note": "" }, "Snack": { "name": "", "note": "" } } },
    { "day": "Friday",    "meals": { "Breakfast": { "name": "", "note": "" }, "Lunch": { "name": "", "note": "" }, "Dinner": { "name": "", "note": "" }, "Snack": { "name": "", "note": "" } } }
  ]
}`;

    const response = await withRetry(() =>
      openai.chat.completions.create({
        model: "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: prompt },
        ],
        max_tokens: 2000,
      })
    );

    const data = JSON.parse(response.choices[0].message.content);
    const DAYS_LIST = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    const MEALS_LIST = ["Breakfast", "Lunch", "Dinner", "Snack"];

    const plan = DAYS_LIST.map(day => {
      const found = (data.plan || []).find(d => d.day === day) || {};
      const meals = {};
      MEALS_LIST.forEach(meal => {
        meals[meal] = { name: found.meals?.[meal]?.name || "", note: found.meals?.[meal]?.note || "" };
      });
      return { day, meals };
    });

    const result = { plan };
    setCache(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate meal plan" });
  }
});

/* ── Recipe Details ── */
app.post("/recipe-details", async (req, res) => {
  try {
    const { recipeName, language = "English" } = req.body;
    const cacheKey = `details:${recipeName}:${language}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const langLine = buildLanguageLine(language);
    const systemMsg = `You are a professional chef and nutritionist.${langLine}`;
    const prompt = `Generate a HIGH-QUALITY, PRACTICAL recipe for: ${recipeName}
Clear step-by-step instructions with timing and heat levels. Include beginner tips. Each step must include "time_min".

RETURN VALID JSON ONLY:
{
  "overview": "",
  "servings": "",
  "prep_time": "",
  "cook_time": "",
  "ingredients": { "main": [{ "name": "", "quantity": "", "qty_number": 0, "unit": "" }] },
  "steps": [{ "text": "Detailed step...", "time_min": 5 }],
  "nutrition": { "calories": "", "protein": "", "carbs": "", "fat": "" }
}`;

    const response = await withRetry(() =>
      openai.chat.completions.create({
        model: "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: prompt },
        ],
      })
    );

    const data = JSON.parse(response.choices[0].message.content);
    if (Array.isArray(data.steps)) {
      data.steps = data.steps.map(s => typeof s === "string" ? { text: s, time_min: null } : s);
    }
    setCache(cacheKey, data);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load recipe details" });
  }
});

/* ── Generate By Name ── */
app.post("/generate-by-name", async (req, res) => {
  try {
    const { recipeName, filters = {}, language = "English" } = req.body;
    if (!recipeName?.trim()) return res.status(400).json({ error: "No recipe name" });

    const cacheKey = `byname:${recipeName.trim().toLowerCase()}:${JSON.stringify({ ...filters, language })}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const filterLines = [];
    if (filters.cuisine?.length) filterLines.push(`- Cuisine: ${filters.cuisine.join(", ")} (NON-NEGOTIABLE)`);
    if (filters.diet?.length)    filterLines.push(`- Diet: ${filters.diet.join(", ")} (NON-NEGOTIABLE)`);
    if (filters.foodTypes?.length) filterLines.push(`- Meal type: ${filters.foodTypes.join(", ")}`);
    if (filters.difficulty)      filterLines.push(`- Difficulty: ${filters.difficulty}`);

    const filterBlock = filterLines.length ? `\nFILTERS:\n${filterLines.join("\n")}\n` : "";
    const langLine = buildLanguageLine(language);
    const systemMsg = `You are a professional chef and nutritionist.${langLine}`;

    const prompt = `Generate a HIGH-QUALITY, PRACTICAL recipe for: "${recipeName}"
${filterBlock}
Clear step-by-step instructions with timing. Include beginner tips. Each step must include "time_min".

RETURN VALID JSON ONLY:
{
  "overview": "",
  "difficulty_label": "",
  "servings": "",
  "prep_time": "",
  "cook_time": "",
  "ingredients": { "main": [{ "name": "", "quantity": "", "qty_number": 0, "unit": "" }] },
  "steps": [{ "text": "Detailed step...", "time_min": 5 }],
  "nutrition": { "calories": "", "protein": "", "carbs": "", "fat": "" },
  "filter_notes": ""
}`;

    const response = await withRetry(() =>
      openai.chat.completions.create({
        model: "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: prompt },
        ],
        max_tokens: 2000,
      })
    );

    const data = JSON.parse(response.choices[0].message.content);
    if (Array.isArray(data.steps)) {
      data.steps = data.steps.map(s => typeof s === "string" ? { text: s, time_min: null } : s);
    }
    const result = { ...data, _title: recipeName.trim() };
    setCache(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate recipe" });
  }
});

/* ── Ingredient Substitution ── */
app.post("/ingredient-sub", async (req, res) => {
  try {
    const { ingredient, recipeName, language = "English" } = req.body;
    if (!ingredient) return res.status(400).json({ error: "No ingredient" });

    const cacheKey = `sub:${ingredient.toLowerCase()}:${(recipeName||"").toLowerCase()}:${language}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const langLine = buildLanguageLine(language);
    const context = recipeName ? ` in the context of making "${recipeName}"` : "";
    const prompt = `You are a chef. Suggest 3 substitutions for "${ingredient}"${context}.
${langLine}

RETURN VALID JSON ONLY:
{ "substitutions": [{ "name": "", "ratio": "", "note": "" }, { "name": "", "ratio": "", "note": "" }, { "name": "", "ratio": "", "note": "" }] }`;

    const response = await withRetry(() =>
      openai.chat.completions.create({
        model: "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
        max_tokens: 400,
      })
    );

    const data = JSON.parse(response.choices[0].message.content);
    setCache(cacheKey, data);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get substitutions" });
  }
});

/* ── Nutrition Summary ── */
app.post("/nutrition-summary", async (req, res) => {
  try {
    const { mealNames = [] } = req.body;
    if (!mealNames.length) return res.status(400).json({ error: "No meals" });

    const cacheKey = `nutsummary:${mealNames.sort().join(",")}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const mealList = mealNames.map((n, i) => `${i + 1}. ${n}`).join("\n");
    const prompt = `You are a nutritionist. Estimate nutrition per serving:
${mealList}

RETURN VALID JSON ONLY:
{ "meals": [{ "name": "", "calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0 }] }`;

    const response = await withRetry(() =>
      openai.chat.completions.create({
        model: "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1000,
      })
    );

    const data = JSON.parse(response.choices[0].message.content);
    setCache(cacheKey, data);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get nutrition" });
  }
});

/* ── Swap Single Meal ── */
app.post("/swap-meal", async (req, res) => {
  try {
    const { day, mealType, currentMeal, ingredients = [], filters = {}, language = "English" } = req.body;
    if (!day || !mealType) return res.status(400).json({ error: "Missing day or mealType" });

    const filterLines = buildFilterLines(filters);
    const filterBlock = filterLines ? `\nFILTER CONSTRAINTS:\n${filterLines}\n` : "";
    const langLine = buildLanguageLine(language);
    const systemMsg = `You are a professional meal planner.${langLine}`;
    const ingredientHint = ingredients.length
      ? `Available ingredients: ${ingredients.map(i => [i.qty, i.unit, i.name].filter(Boolean).join(" ")).join(", ")}.`
      : "";

    const prompt = `${filterBlock}
Suggest ONE new ${mealType} meal for ${day}.
${ingredientHint}
${currentMeal ? `Do NOT suggest "${currentMeal}" — it must be a different meal.` : ""}
Keep it practical and quick.

RETURN VALID JSON ONLY:
{ "name": "", "note": "" }`;

    const response = await withRetry(() =>
      openai.chat.completions.create({
        model: "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: prompt },
        ],
        max_tokens: 200,
      })
    );
    const data = JSON.parse(response.choices[0].message.content);
    res.json({ name: data.name || "", note: data.note || "" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to swap meal" });
  }
});

/* ── Generate By Nutrition ── */
app.post("/generate-by-nutrition", async (req, res) => {
  try {
    const { targets = {}, filters = {}, language = "English" } = req.body;
    const targetLines = [
      targets.calories && `- Calories per serving: ~${targets.calories} kcal`,
      targets.protein  && `- Protein per serving: ~${targets.protein}g`,
      targets.carbs    && `- Carbs per serving: ~${targets.carbs}g`,
      targets.fat      && `- Fat per serving: ~${targets.fat}g`,
      targets.fiber    && `- Dietary Fiber per serving: ~${targets.fiber}g`,
    ].filter(Boolean);
    if (!targetLines.length) return res.status(400).json({ error: "No nutrition targets provided" });

    const filterLines = buildFilterLines(filters);
    const filterBlock = filterLines ? `\nFILTER CONSTRAINTS:\n${filterLines}\n` : "";
    const langLine = buildLanguageLine(language);
    const systemMsg = `You are a professional nutritionist and chef.${langLine}`;

    const prompt = `${filterBlock}
Generate exactly 4 distinct recipes that match these per-serving nutrition targets as closely as possible:
${targetLines.join("\n")}
${filterLines ? "All filter constraints above must be strictly followed." : ""}
No duplicate titles. Each recipe must be practical and cookable.

RETURN VALID JSON ONLY:
{
  "recipes": [
    {
      "title": "",
      "preview": "",
      "calories": 0,
      "protein_g": 0,
      "carbs_g": 0,
      "fat_g": 0,
      "fiber_g": 0,
      "match_note": "one sentence on how well this matches the targets"
    }
  ]
}`;

    const response = await withRetry(() =>
      openai.chat.completions.create({
        model: "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: prompt },
        ],
        max_tokens: 1200,
      })
    );
    const data = JSON.parse(response.choices[0].message.content);
    res.json({ recipes: (data.recipes || []).slice(0, 4) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate nutrition-based recipes" });
  }
});

/* ── AI Chef Chat ── */
app.post("/chat", async (req, res) => {
  try {
    const {
      messages = [],
      pantry = [],
      savedRecipeNames = [],
      language = "English",
    } = req.body;

    if (!messages.length) return res.status(400).json({ error: "No messages" });

    const pantryInStock = pantry.filter(i => i.inStock !== false);
    const pantryStr = pantryInStock.length
      ? pantryInStock.map(i => [i.qty, i.unit, i.name].filter(Boolean).join(" ")).join(", ")
      : "No pantry items added yet";

    const savedStr = savedRecipeNames.length
      ? savedRecipeNames.slice(0, 20).join(", ")
      : "No saved recipes yet";

    const langInstruction = language !== "English"
      ? `\nIMPORTANT: Respond in ${language} only.`
      : "";

    const systemPrompt = `You are ChefMind AI — a warm, expert personal chef assistant built into the ChefMind cooking app. You have full knowledge of the user's kitchen context.

## User's Current Pantry
${pantryStr}

## User's Saved Recipes
${savedStr}

## Your Capabilities
- Suggest recipes using pantry ingredients (reference them by name)
- Help adapt any recipe (make it vegan, gluten-free, lower calorie, etc.)
- Answer cooking technique questions with clear, practical advice
- Suggest food & drink pairings (wine, cocktails, sides)
- Help troubleshoot cooking mistakes ("my sauce is too salty — how do I fix it?")
- Provide substitution ideas for any ingredient
- Give meal prep tips and time-saving strategies
- Explain food science in simple terms
- Help scale recipes up or down

## Response Style
- Be warm, conversational and encouraging — like a knowledgeable friend in the kitchen
- When listing steps or options, use clear numbered lists or bullet points
- Reference the user's actual pantry ingredients when relevant ("Since you have rice and eggs, you could make...")
- Keep responses focused and practical — avoid unnecessary filler
- For recipes, always include rough cook time and difficulty
- If asked something outside cooking/food, gently redirect back to culinary topics${langInstruction}`;

    const openaiMessages = messages.map(m => ({ role: m.role, content: m.content }));

    const response = await withRetry(() =>
      openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: systemPrompt },
          ...openaiMessages,
        ],
        max_tokens: 1000,
        temperature: 0.8,
      })
    );

    res.json({ reply: response.choices[0].message.content });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Chef is unavailable right now — please try again" });
  }
});

/* ── Password Strength Validator ── */
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]).{8,}$/;
const validatePassword = (p) => {
  if (!p || p.length < 8)           return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(p))             return "Password must contain at least one uppercase letter";
  if (!/[a-z]/.test(p))             return "Password must contain at least one lowercase letter";
  if (!/\d/.test(p))                return "Password must contain at least one number";
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(p)) return "Password must contain at least one special character";
  return null;
};

/* ── Auth Routes ── */
app.post("/auth/signup", async (req, res) => {
  try {
    const { name, username, email, password } = req.body;
    if (!name?.trim() || !username?.trim() || !email?.trim() || !password)
      return res.status(400).json({ error: "All fields required" });

    // Username: alphanumeric + underscores only, 3-20 chars
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username.trim()))
      return res.status(400).json({ error: "Username must be 3–20 characters and contain only letters, numbers, or underscores" });

    const pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ error: pwErr });

    if (await User.findOne({ email: email.toLowerCase() }))
      return res.status(400).json({ error: "Email already registered" });
    if (await User.findOne({ username: username.toLowerCase() }))
      return res.status(400).json({ error: "Username already taken — please choose another" });

    const user = await User.create({ name: name.trim(), username: username.trim(), email, password });

    // Send welcome email (non-blocking)
    sendMail({
      to: user.email,
      subject: `Welcome to Fridgely, ${user.name}! 🥬`,
      html: welcomeEmail(user.name),
    }).catch(err => console.error("Welcome email failed:", err));

    res.json({ token: genToken(user._id), user: serializeUser(user) });
  } catch (err) { console.error("Signup:", err); res.status(500).json({ error: "Signup failed" }); }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { identifier, password } = req.body;   // identifier = email OR username
    if (!identifier || !password)
      return res.status(400).json({ error: "Email/username and password required" });

    const isEmail = identifier.includes("@");
    const user = isEmail
      ? await User.findOne({ email: identifier.toLowerCase() })
      : await User.findOne({ username: identifier.toLowerCase() });

    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: "Invalid credentials" });

    res.json({ token: genToken(user._id), user: serializeUser(user) });
  } catch (err) { console.error("Login:", err); res.status(500).json({ error: "Login failed" }); }
});

app.get("/auth/me", auth, (req, res) => res.json({ user: serializeUser(req.user) }));

/* ── Forgot Password ── */
app.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const user = await User.findOne({ email: email.toLowerCase() });
    // Always return 200 to prevent user enumeration
    if (!user) return res.json({ ok: true });

    const token   = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    user.resetPasswordToken   = token;
    user.resetPasswordExpires = expires;
    await user.save();

    const resetUrl = `${APP_URL}/reset-password?token=${token}`;
    await sendMail({
      to: user.email,
      subject: "Reset your Fridgely password",
      html: resetEmail(user.name, resetUrl),
    });

    res.json({ ok: true });
  } catch (err) { console.error("Forgot password:", err); res.status(500).json({ error: "Failed to send reset email" }); }
});

/* ── Reset Password ── */
app.post("/auth/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: "Token and new password required" });

    const pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ error: pwErr });

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() },
    });
    if (!user) return res.status(400).json({ error: "Reset link is invalid or has expired" });

    user.password             = password;  // pre-save hook will hash it
    user.resetPasswordToken   = null;
    user.resetPasswordExpires = null;
    await user.save();

    res.json({ ok: true, message: "Password reset successfully" });
  } catch (err) { console.error("Reset password:", err); res.status(500).json({ error: "Failed to reset password" }); }
});

/* ── Check username availability ── */
app.get("/auth/check-username", async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: "Username required" });
    const exists = await User.findOne({ username: username.toLowerCase() });
    res.json({ available: !exists });
  } catch { res.status(500).json({ error: "Check failed" }); }
});

/* ── User Data Sync Routes ── */
app.get("/user/data", auth, async (req, res) => res.json(serializeUser(req.user)));

app.put("/user/pantry", auth, async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { pantryItems: req.body.pantryItems || [] });
  res.json({ ok: true });
});

app.put("/user/saved-recipes", auth, async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { savedRecipes: req.body.savedRecipes || [] });
  res.json({ ok: true });
});

app.put("/user/grocery", auth, async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { groceryList: req.body.groceryList || [] });
  res.json({ ok: true });
});

app.put("/user/history", auth, async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { recipeHistory: req.body.recipeHistory || [] });
  res.json({ ok: true });
});

app.put("/user/notes", auth, async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, {
    recipeNotes: new Map(Object.entries(req.body.recipeNotes || {}))
  });
  res.json({ ok: true });
});

app.put("/user/language", auth, async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { language: req.body.language });
  res.json({ ok: true });
});

app.post("/user/rating", auth, async (req, res) => {
  try {
    const { recipe, rating } = req.body;
    const user = await User.findById(req.user._id);
    if (!rating || rating === 0) {
      user.recipeRatings.delete(recipe);
      await RecipeRating.deleteOne({ recipe, userId: req.user._id });
    } else {
      user.recipeRatings.set(recipe, rating);
      await RecipeRating.findOneAndUpdate(
        { recipe, userId: req.user._id },
        { rating },
        { upsert: true, new: true }
      );
    }
    await user.save();
    res.json({ ok: true });
  } catch (err) { console.error("Rating:", err); res.status(500).json({ error: "Failed to save rating" }); }
});

app.post("/user/activity", auth, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      $push: { pageActivity: { $each: [{ page: req.body.page }], $slice: -500 } }
    });
    res.json({ ok: true });
  } catch { res.json({ ok: true }); }
});

/* ── Community Top Rated ── */
app.get("/top-rated", async (req, res) => {
  try {
    const results = await RecipeRating.aggregate([
      { $group: {
        _id: "$recipe",
        avgRating: { $avg: "$rating" },
        totalRatings: { $sum: 1 },
      }},
      { $sort: { avgRating: -1, totalRatings: -1 } },
      { $limit: 30 },
    ]);
    res.json({ recipes: results.map(r => ({
      title: r._id,
      avgRating: Math.round(r.avgRating * 10) / 10,
      totalRatings: r.totalRatings,
    }))});
  } catch (err) { console.error("Top rated:", err); res.status(500).json({ error: "Failed to fetch top rated" }); }
});

/* ── Start ── */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 ChefMind running on http://localhost:${PORT}`));