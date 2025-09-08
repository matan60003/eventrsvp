EventRSVP (Vite + React + Tailwind) – FIXED CONFIG
Steps:
1) npm install
2) npm run dev
If you had the white-screen/CSS error before:
- Delete 'node_modules' and 'package-lock.json' (if exists), then run npm install again.
- Ensure configs use CommonJS:
  - postcss.config.cjs
  - tailwind.config.cjs
Use 'guests.example.csv' to test CSV upload.
