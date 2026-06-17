import sequelize from '../config/db.js';
import MainCategory from '../models/superadmin-models/MainCategory.js';

const categories = [
  {
    id: "181dc27a-0b4d-4bbd-803a-4639dcd5418e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779236733507-75395332b24e380b8fb15354be54adb6.png",
    title: { en: "Mukhwas ", gu: "મુખવાસ ", hn: "मुखवास " },
    description: {},
    position: 4,
    status: "Active",
    isTobacco: false
  },
  {
    id: "29c2297c-ed38-4c6d-bffb-1aaddedc70e7",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779234660766-48889ae3a3f709722e807327457d8995.png",
    title: { en: "Panmasala ", gu: "પાનમસાલા ", hn: "पानमसाला " },
    description: {},
    position: 2,
    status: "Active",
    isTobacco: true
  },
  {
    id: "47b5d282-9cd2-4656-a695-8c237b4b2bfb",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779232883532-640fbdef5895e7eb877e700e3c5243e5.png",
    title: { en: "Cigret ", gu: "સિગરેટ ", hn: "सिगरेट " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "85ac7df8-d796-4bfb-919b-0db32b529bdb",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780215824755-ac67e73db1f13508313e7fe4f75ff1e3.webp",
    title: { en: "Biscuit ", gu: "બિસકીટ", hn: "बिस्किट " },
    description: {},
    position: 6,
    status: "Active",
    isTobacco: false
  },
  {
    id: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780220320311-fb85c600bcce5db355e4f995654d78cf.webp",
    title: { en: "General", gu: "જનરલ", hn: "जनरल" },
    description: {},
    position: 8,
    status: "Active",
    isTobacco: false
  },
  {
    id: "957aefc5-ee15-40b9-9709-8d148f0be855",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779233819522-0a0b0efa7d297cda412083b766231441.png",
    title: { en: "Tambakoo ", gu: "તમ્બાકૂ ", hn: "તમ્બાકૂ " },
    description: {},
    position: 1,
    status: "Active",
    isTobacco: true
  },
  {
    id: "9f8ef570-3ab7-4f5e-86ef-87041211c4d5",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779235955170-ea1550df2bdc3b1ebbea917251f7e854.png",
    title: { en: "Tobacco", gu: "ટોબેકો\t\t\t\t\t\t\t\t\t\t\t\t", hn: "टोबैકો " },
    description: {},
    position: 3,
    status: "Active",
    isTobacco: true
  },
  {
    id: "ddaaf65c-bf04-48eb-84bf-0000d47e784e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780217293113-3ca744b88ea471e09972695fda918c9f.webp",
    title: { en: "Cold Drinks ", gu: "કોલ્ડ ડ્રિંક્સ ", hn: "કોલ્ડ ડ્રિંક્સ " },
    description: {},
    position: 7,
    status: "Active",
    isTobacco: false
  },
  {
    id: "e3e0e795-e272-4b87-9f8c-82fd8122634d",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780216122092-666587d710e5f93940268af391629eb8.webp",
    title: { en: "Choclate ", gu: "ચોકલેટે ", hn: "चोक्लेट" },
    description: {},
    position: 5,
    status: "Active",
    isTobacco: false
  }
];

const seed = async () => {
    try {
        await sequelize.authenticate();
        console.log('[Seed] Database connected successfully.');
        
        for (const cat of categories) {
            await MainCategory.upsert(cat);
        }
        
        console.log('[Seed] All categories imported successfully ✓');
        process.exit(0);
    } catch (error) {
        console.error('[Seed Error] Failed to seed categories:', error.message);
        process.exit(1);
    }
};

seed();
