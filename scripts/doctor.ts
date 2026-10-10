import 'dotenv/config';
import fs from 'fs';

console.log("==================================================");
console.log("🩺 X-RAY REPORTING APP — WORKSTATION DEVELOPMENT DOCTOR");
console.log("==================================================");

let warnings = 0;
let passes = 0;

// 1. Check Node.js
try {
  const nodeVersion = process.version;
  console.log(`✅ Node.js Version: ${nodeVersion}`);
  passes++;
} catch (err: any) {
  console.log(`❌ Node.js Check Failed: ${err.message}`);
  warnings++;
}

// 2. Check Package.json Dependencies
try {
  if (fs.existsSync('package.json')) {
    console.log("✅ package.json found");
    passes++;
  } else {
    console.log("❌ package.json NOT found at workspace root");
    warnings++;
  }
} catch (err: any) {
  console.log(`❌ package.json check failed: ${err.message}`);
  warnings++;
}

// 3. Check .env config & selectors
console.log("\n📡 Checking Backend Configuration Selector State...");
const requiredKeys = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
];

const envExists = fs.existsSync('.env');
if (!envExists) {
  console.log("⚠️  No .env file found at root. Checking .env.example...");
  warnings++;
  if (fs.existsSync('.env.example')) {
    console.log("💡 Found .env.example. Copy this file to .env to populate your local settings.");
  } else {
    console.log("❌ .env.example also missing! Check git tracking.");
  }
} else {
  console.log("✅ .env file present");
  passes++;
  
  requiredKeys.forEach(key => {
    const value = process.env[key];
    if (value) {
      console.log(`   - ${key}: [CONFIGURED]`);
      passes++;
    } else {
      console.log(`   - ${key}: [MISSING/EMPTY] ⚠️`);
      warnings++;
    }
  });
}

// 4. Check backend target values
console.log("\n🎯 Target Backend Runtimes:");
console.log(`   - Supabase URL: ${process.env.VITE_SUPABASE_URL || 'undefined'}`);
console.log(`   - App Port: ${process.env.PORT || '3000'}`);

console.log("\n==================================================");
console.log(`🏁 DOCTOR VERDICT: ${passes} Passed, ${warnings} Warning(s)`);
console.log("==================================================");
if (warnings === 0) {
  console.log("🎉 Environment is perfectly configured for local development!");
} else {
  console.log("💡 Review the warnings above to ensure consistent workspace portability.");
}
