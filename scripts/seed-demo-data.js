import process from 'process';

const API_BASE = process.env.API_BASE || 'http://localhost:5000';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

const ADMIN_BASE = `${API_BASE.replace(/\/$/, '')}/api/admin`;

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
}

async function httpJson(url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg = json?.message || json?.error || text || `HTTP ${res.status}`;
    throw new Error(`${method} ${url} failed: ${msg}`);
  }
  return json;
}

async function loginAndGetToken() {
  requireEnv('ADMIN_EMAIL', ADMIN_EMAIL);
  requireEnv('ADMIN_PASSWORD', ADMIN_PASSWORD);

  const json = await httpJson(`${ADMIN_BASE}/auth/login`, {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  const token = json?.data?.token || json?.data?.data?.token || json?.token;
  if (!token) throw new Error('Login succeeded but token missing in response.');
  return token;
}

async function getList(token, path) {
  const json = await httpJson(`${ADMIN_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return json?.data?.data || json?.data?.products || json?.data?.volumes || json?.data?.godowns || json?.data || [];
}

function pickFirstActive(list) {
  return (list || []).find((x) => x?.status === 'Active') || (list || [])[0] || null;
}

function volLabel(vol) {
  return vol?.name?.en || Object.values(vol?.name || {})[0] || '';
}

function normalizeBaseUnitLabel(s) {
  const v = String(s || '').trim().toLowerCase();
  if (v === 'pc' || v === 'pcs' || v === 'piece' || v === 'pieces') return 'pcs';
  if (v === 'g' || v === 'gm' || v === 'gram' || v === 'grams') return 'gram';
  if (v === 'ml' || v === 'milliliter' || v === 'milliliters') return 'ml';
  return 'pcs';
}

function buildDemoProducts() {
  const P = (nameEn, variants) => ({ name: { en: nameEn }, variants });
  const V = (label, baseUnitLabel, baseUnitsPerPack, purchasePrice, sellPrice, mrp, packQty, unitGuess) => ({
    label,
    baseUnitLabel: normalizeBaseUnitLabel(baseUnitLabel),
    baseUnitsPerPack,
    purchasePrice,
    sellPrice,
    mrp,
    packQty,
    unitGuess, // used to match Volume unit (ml/gram/pcs)
  });

  return [
    P('Sopari Premium', [
      V('250 gram', 'gram', 250, 180, 200, 220, 20, 'gram'),
      V('500 gram', 'gram', 500, 340, 380, 420, 15, 'gram'),
      V('1 kg', 'gram', 1000, 650, 720, 800, 10, 'gram'),
    ]),
    P('Cigarette Classic', [
      V('Dando', 'pcs', 20, 260, 290, 320, 50, 'pcs'),
      V('Box', 'pcs', 200, 2500, 2750, 3000, 10, 'pcs'),
    ]),
    P('Tambaku Regular', [
      V('Padiki', 'pcs', 1, 18, 22, 25, 200, 'pcs'),
      V('Dabba', 'pcs', 50, 800, 950, 1100, 15, 'pcs'),
      V('Jumbo Box', 'pcs', 500, 7200, 8200, 9000, 4, 'pcs'),
    ]),
    P('Soda Bottle', [
      V('300 ml bottle crate', 'pcs', 24, 360, 420, 480, 8, 'pcs'),
      V('500 ml bottle crate', 'pcs', 24, 480, 560, 640, 6, 'pcs'),
      V('1 liter bottle crate', 'pcs', 12, 360, 420, 480, 6, 'pcs'),
    ]),
    P('Red Bull', [
      V('250 ml can pack', 'pcs', 24, 2200, 2600, 2900, 6, 'pcs'),
    ]),
    P('Dragon Energy', [
      V('250 ml can pack', 'pcs', 24, 1600, 1900, 2200, 6, 'pcs'),
    ]),
    P('Cooking Oil', [
      V('1 liter pouch', 'ml', 1000, 140, 160, 180, 50, 'ml'),
      V('5 liter can', 'ml', 5000, 680, 760, 820, 12, 'ml'),
    ]),
    P('Wafers', [
      V('Small packet', 'pcs', 1, 8, 10, 12, 300, 'pcs'),
      V('Family pack', 'pcs', 1, 18, 22, 25, 200, 'pcs'),
    ]),
    P('Namkeen Mix', [
      V('200 gram pack', 'gram', 200, 40, 50, 60, 120, 'gram'),
      V('500 gram pack', 'gram', 500, 90, 110, 130, 80, 'gram'),
    ]),
    P('Sabu Soap', [
      V('Single bar', 'pcs', 1, 18, 22, 25, 200, 'pcs'),
      V('Box (48 bars)', 'pcs', 48, 800, 950, 1100, 10, 'pcs'),
    ]),
    P('Chips', [
      V('Small pack', 'pcs', 1, 8, 10, 12, 300, 'pcs'),
      V('Big pack', 'pcs', 1, 18, 22, 25, 200, 'pcs'),
    ]),
    P('Tea', [
      V('250 gram', 'gram', 250, 120, 140, 160, 60, 'gram'),
      V('1 kg', 'gram', 1000, 420, 480, 550, 20, 'gram'),
    ]),
    P('Sugar', [
      V('1 kg', 'gram', 1000, 42, 50, 60, 80, 'gram'),
      V('5 kg', 'gram', 5000, 200, 230, 260, 20, 'gram'),
    ]),
    P('Salt', [
      V('1 kg', 'gram', 1000, 18, 22, 28, 80, 'gram'),
      V('5 kg', 'gram', 5000, 80, 95, 110, 20, 'gram'),
    ]),
    P('Toothpaste', [
      V('100 gram', 'gram', 100, 55, 65, 75, 120, 'gram'),
      V('200 gram', 'gram', 200, 95, 110, 130, 80, 'gram'),
    ]),
    P('Shampoo', [
      V('100 ml', 'ml', 100, 55, 65, 75, 120, 'ml'),
      V('500 ml', 'ml', 500, 220, 260, 300, 40, 'ml'),
    ]),
    P('Biscuits', [
      V('Single pack', 'pcs', 1, 8, 10, 12, 300, 'pcs'),
      V('Family pack', 'pcs', 1, 18, 22, 25, 200, 'pcs'),
    ]),
    P('Masala', [
      V('100 gram', 'gram', 100, 30, 36, 42, 150, 'gram'),
      V('500 gram', 'gram', 500, 130, 150, 170, 60, 'gram'),
    ]),
    P('Milk', [
      V('500 ml', 'ml', 500, 26, 30, 34, 120, 'ml'),
      V('1 liter', 'ml', 1000, 50, 58, 64, 80, 'ml'),
    ]),
  ];
}

async function main() {
  const token = await loginAndGetToken();

  const [volumes, levels, godowns, mainCats, subCats, companyCats] = await Promise.all([
    getList(token, '/volumes?paginate=false'),
    getList(token, '/custom-levels?paginate=false'),
    getList(token, '/godowns?paginate=false'),
    getList(token, '/main-categories?paginate=false'),
    getList(token, '/sub-categories?paginate=false'),
    getList(token, '/company-categories?paginate=false'),
  ]);

  const activeLevel = pickFirstActive(levels);
  const activeGodown = pickFirstActive(godowns);
  const activeMain = pickFirstActive(mainCats);
  const activeSub = pickFirstActive(subCats);
  const activeCompany = pickFirstActive(companyCats);

  if (!activeLevel) throw new Error('No CustomLevel found. Please create at least one Custom Level.');
  if (!activeGodown) throw new Error('No Godown found. Please create at least one Godown.');
  if (!activeMain || !activeSub || !activeCompany) {
    throw new Error('Categories missing. Please ensure Main/Sub/Company categories exist.');
  }

  const placeholderThumb = 'https://picsum.photos/seed/apnatobacco/256/256';
  const placeholderImages = [
    'https://picsum.photos/seed/apnatobacco-1/800/800',
  ];

  const demoProducts = buildDemoProducts();

  for (const p of demoProducts) {
    // Map variant unit to Volume unitId (optional for display volume string)
    const mappedVariants = p.variants.map((vv) => {
      // find a volume unit that matches vv.label unit (gram/ml) — fallback to first active volume
      let volumeRow = null;
      if (vv.unitGuess) {
        volumeRow = (volumes || []).find((u) => volLabel(u).trim().toLowerCase() === String(vv.unitGuess).trim().toLowerCase());
      }
      volumeRow = volumeRow || (volumes || [])[0] || null;
      if (!volumeRow) throw new Error('No Volume units found. Please create Volume units (pcs/gram/ml/etc).');

      const volumeValueMatch = String(vv.label).match(/^([\d.]+)/);
      const volumeValue = volumeValueMatch ? volumeValueMatch[1] : '1';

      return {
        volumeId: volumeRow.id,
        volumeValue,
        purchasePrice: vv.purchasePrice,
        baseUnitLabel: vv.baseUnitLabel,
        baseUnitsPerPack: vv.baseUnitsPerPack,
        status: 'Active',
        levelGroups: [
          {
            customLevelId: activeLevel.id,
            pricings: [
              {
                quantityFrom: 1,
                quantityTo: 999999,
                price: vv.sellPrice,
                mrp: vv.mrp,
                status: 'Active',
              },
            ],
          },
        ],
      };
    });

    const productPayload = {
      name: p.name,
      thumbnail: placeholderThumb,
      images: placeholderImages,
      mainCategoryId: activeMain.id,
      subCategoryId: activeSub.id,
      companyCategoryId: activeCompany.id,
      productDescription: { keyInformation: [], nutritionalInformation: [], info: [] },
      status: 'Active',
      variants: mappedVariants,
    };

    const created = await httpJson(`${ADMIN_BASE}/products`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: productPayload,
    });

    const productId = created?.data?.id || created?.data?.data?.id;
    if (!productId) {
      // Still continue, but warn
      console.log(`Created product: ${p.name?.en || 'Unnamed'} (id missing in response)`);
      continue;
    }

    // Fetch product again to get variantIds
    const prod = await httpJson(`${ADMIN_BASE}/products/${productId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const product = prod?.data;
    const createdVariants = product?.variants || [];

    // Create inventory purchase for each variant
    for (const vv of p.variants) {
      const createdVariant = createdVariants.find((x) => String(x.volume || '').toLowerCase().includes(String(vv.label).split(' ')[0].toLowerCase()));
      const variantId = createdVariant?.id || createdVariants?.[0]?.id;
      if (!variantId) continue;

      // Primary unit should match baseUnitLabel if exists in Volumes table
      const unitRow = (volumes || []).find((u) => volLabel(u).trim().toLowerCase() === String(vv.baseUnitLabel).trim().toLowerCase()) || (volumes || [])[0];

      const totalBaseUnits = Number(vv.packQty) * Number(vv.baseUnitsPerPack);

      await httpJson(`${ADMIN_BASE}/inventory/transactions/purchase`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: {
          productId,
          variantId,
          godownId: activeGodown.id,
          primaryUnitId: unitRow.id,
          secondaryUnitId: null,
          secondaryPerPrimary: 1,
          qtyPrimary: totalBaseUnits,
          qtySecondary: 0,
          purchasePricePerBaseUnit: Number(vv.purchasePrice),
          note: `Seed: ${vv.packQty} pack(s) of ${vv.label}`,
        },
      });
    }

    console.log(`Seeded product + inventory: ${p.name?.en || 'Unnamed'}`);
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

