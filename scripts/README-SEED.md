## Demo Seed Script (20 products + inventory)

This script will:
- Login as an admin (Bearer token)
- Create ~20 demo products with multiple variants (pcs/gram/ml)
- Create inventory purchase entries for each variant into the first active godown

### Prerequisites
- Backend running (local or production)
- At least 1:
  - Custom Level
  - Godown
  - Main Category + Sub Category + Company Category
  - Volume units (recommended: `pcs`, `gram`, `ml`)

### Run (local)

PowerShell:

```powershell
$env:API_BASE="http://localhost:5000"
$env:ADMIN_EMAIL="YOUR_ADMIN_EMAIL"
$env:ADMIN_PASSWORD="YOUR_ADMIN_PASSWORD"
node .\scripts\seed-demo-data.js
```

### Run (production)

```bash
API_BASE="https://api.apnatobacco.com" \
ADMIN_EMAIL="YOUR_ADMIN_EMAIL" \
ADMIN_PASSWORD="YOUR_ADMIN_PASSWORD" \
node ./scripts/seed-demo-data.js
```

### Notes
- Images use a public placeholder URL.
- Inventory is created as PURCHASE transactions with `secondaryPerPrimary=1`.
- If you want a specific godown/category/level, update the script to pick the desired record.

