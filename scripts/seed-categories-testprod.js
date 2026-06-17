import sequelize from '../config/db.js';
import MainCategory from '../models/superadmin-models/MainCategory.js';
import SubCategory from '../models/superadmin-models/SubCategory.js';

const mainCategories = [
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

const subCategories = [
  {
    id: "0d9d9bbd-6b49-47fa-80a4-980a7e7aecb0",
    mainCategoryId: "85ac7df8-d796-4bfb-919b-0db32b529bdb",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779369737623-26fe5b33003e6d90dffc74f9244bb8a4.webp",
    title: { en: "Khari", gu: "ખારી ", hn: "खारी" },
    description: {},
    position: 26,
    status: "Active",
    isTobacco: false
  },
  {
    id: "1c8790fd-e029-497e-b4b1-89bc46eeae17",
    mainCategoryId: "181dc27a-0b4d-4bbd-803a-4639dcd5418e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779012956620-50b2223dc090229e45d938ab5894b5e5.jpeg",
    title: { en: "All Mukhwas Product ", gu: "All મુખવાસ પ્રોડક્ટ ", hn: "All मुखवास प्रोडक्ट " },
    description: {},
    position: 15,
    status: "Active",
    isTobacco: false
  },
  {
    id: "26620d41-b103-43b1-a5f0-521852931c70",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779235387012-49f67bcffc1b3ef029b41a3106c33a7c.webp",
    title: { en: "Sabu ", gu: "સાબુ ", hn: "સાબુ" },
    description: {},
    position: 22,
    status: "Active",
    isTobacco: false
  },
  {
    id: "2f2c2843-15f6-46f8-a121-68de5c4912c5",
    mainCategoryId: "181dc27a-0b4d-4bbd-803a-4639dcd5418e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779012551307-7d716b56f92ba4ad5a83d54ffbaae19f.webp",
    title: { en: "DhanaDal ", gu: "ધાણાદાળ ", hn: "ધાણાદાળ" },
    description: {},
    position: 14,
    status: "Active",
    isTobacco: false
  },
  {
    id: "30fc9431-1658-44b0-a249-08a88d8f8839",
    mainCategoryId: "957aefc5-ee15-40b9-9709-8d148f0be855",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1778853405465-de522e1f1d53b7e2636428c9ee0f7a26.webp",
    title: { en: "All Tambakoo ", gu: "All તમ્બાકૂ ", hn: "All तम्बाकू " },
    description: {},
    position: 3,
    status: "Active",
    isTobacco: true
  },
  {
    id: "57b13a13-c815-49fe-89f8-c8fed893e5d1",
    mainCategoryId: "957aefc5-ee15-40b9-9709-8d148f0be855",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1778853288877-c236fd89ce2638b7c1a491fcdf645d61.webp",
    title: { en: "Bagban Tambakoo ", gu: "બાગબાન તમ્બાકૂ ", hn: "बागबान तम्बाकू " },
    description: {},
    position: 2,
    status: "Active",
    isTobacco: true
  },
  {
    id: "5a4bd83a-9a05-4753-8822-a2141229d90a",
    mainCategoryId: "ddaaf65c-bf04-48eb-84bf-0000d47e784e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1778848069269-5a16fe96bd77a9ee492b5f3588742bb1.webp",
    title: { en: "Water ", gu: "પાણી   ", hn: "पानी " },
    description: {},
    position: 8,
    status: "Active",
    isTobacco: false
  },
  {
    id: "60c72c0f-17dd-44a0-8891-bd40cbe20cfb",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779127314092-a53ccecadb23717e57090643fc7f6a2e.webp",
    title: { en: "Pato ", gu: "પતો ", hn: "पतो " },
    description: {},
    position: 20,
    status: "Active",
    isTobacco: false
  },
  {
    id: "63e2c651-62ae-4d0d-843b-0d70d3ee7a4e",
    mainCategoryId: "ddaaf65c-bf04-48eb-84bf-0000d47e784e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779005325634-04ed03d2c32f7d591f54711753c956ef.webp",
    title: { en: "Coffee", gu: "કોફી ", hn: "कोफी " },
    description: {},
    position: 10,
    status: "Active",
    isTobacco: false
  },
  {
    id: "87ca780e-1292-44fc-a403-31fe2784ef6d",
    mainCategoryId: "ddaaf65c-bf04-48eb-84bf-0000d47e784e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1778848093809-b9d7da1cc48bb42e06124bf0d0655418.webp",
    title: { en: "Energy Drinks ", gu: "એનર્જી ડ્રિંક્સ  ", hn: "એનર્જી ડ્રિંક્સ  " },
    description: {},
    position: 7,
    status: "Active",
    isTobacco: false
  },
  {
    id: "8a34d118-6aaa-4f13-9dd3-3181c00ce609",
    mainCategoryId: "47b5d282-9cd2-4656-a695-8c237b4b2bfb",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1778849890504-e7575c7430548269b81644cae7367936.webp",
    title: { en: "All Cigaret ", gu: "All સીગરેટ ", hn: "All सिगरेट" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "96233cb1-5457-44bd-ad41-d57c8afaafd4",
    mainCategoryId: "e3e0e795-e272-4b87-9f8c-82fd8122634d",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779021602335-5d7f6afe0145f82c5877d26bd3e8b388.webp",
    title: { en: "Cadbury Choclate ", gu: "કેડબરી ચોકલેટે", hn: "कैडबरी चॉक्लेट" },
    description: {},
    position: 18,
    status: "Active",
    isTobacco: false
  },
  {
    id: "96b0e3a0-3b33-49b8-af34-ff83a7604283",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779309683167-5d491d757e272051a0dd07daec6a62cb.webp",
    title: { en: "Spre ", gu: "સ્પ્રે ", hn: "સ્પ્રે " },
    description: {},
    position: 23,
    status: "Active",
    isTobacco: false
  },
  {
    id: "a1466b69-4d9b-48a9-a7b2-46ac106cd07b",
    mainCategoryId: "85ac7df8-d796-4bfb-919b-0db32b529bdb",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779005288818-b28278c6f36441eaf86d4cf5aea06d16.webp",
    title: { en: "Sada Biscuit ", gu: "સાદા બિસ્કિટ", hn: "सादा बिस्किट " },
    description: {},
    position: 11,
    status: "Active",
    isTobacco: false
  },
  {
    id: "a44dfde9-48f4-489f-9331-46b60f43d164",
    mainCategoryId: "29c2297c-ed38-4c6d-bffb-1aaddedc70e7",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1778920917019-e1b34ed9aa4773677e1b20a7dab0092e.webp",
    title: { en: "Gutkha Tambakoo", gu: "ગુટખા તમ્બાકૂ", hn: "ગુટખા તમ્બાકૂ" },
    description: {},
    position: 5,
    status: "Deleted",
    isTobacco: true
  },
  {
    id: "a4cdce88-126a-42b5-a6f4-f27e9d29afbc",
    mainCategoryId: "85ac7df8-d796-4bfb-919b-0db32b529bdb",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779006304063-b1674a102920491bf9a6e5ad43aa4ead.webp",
    title: { en: "Cream Biscuit ", gu: "ક્રીમ બિસ્કિટ", hn: "क्रीम बिस्किट " },
    description: {},
    position: 12,
    status: "Active",
    isTobacco: false
  },
  {
    id: "a76e1f82-411c-4d22-b706-095734df5f4d",
    mainCategoryId: "e3e0e795-e272-4b87-9f8c-82fd8122634d",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779021940439-2bb50648103606be863f004f767f921a.webp",
    title: { en: "Chewing Gum", gu: "ચેવિન્ગમ", hn: "चेविंगम" },
    description: {},
    position: 17,
    status: "Active",
    isTobacco: false
  },
  {
    id: "a98d3877-dcda-4cca-92ad-8e74d8ab854e",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779124899354-981aba428407cb948e6dde8b3ef66511.webp",
    title: { en: "Chai", gu: "ચા", hn: "चाय " },
    description: {},
    position: 19,
    status: "Active",
    isTobacco: false
  },
  {
    id: "a9e3d94e-ee97-4378-b103-c0e60a24257b",
    mainCategoryId: "ddaaf65c-bf04-48eb-84bf-0000d47e784e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1778848045940-0deb3e4af55b0a8a77a62792ab03c5f3.webp",
    title: { en: "All cold Drinks", gu: "All કોલ્ડડ્રિંક્સ ", hn: "All कोल्डड्रिंक्स " },
    description: {},
    position: 9,
    status: "Active",
    isTobacco: false
  },
  {
    id: "b6599734-1f3e-4b90-b89e-fc4324bfbc2e",
    mainCategoryId: "29c2297c-ed38-4c6d-bffb-1aaddedc70e7",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1778920880030-4d05dee15d0cecfcd612c0705f2826e0.webp",
    title: { en: "All Gutkha ", gu: "All ગુટખા", hn: "All गुटखा" },
    description: {},
    position: 4,
    status: "Active",
    isTobacco: true
  },
  {
    id: "c9e0d1e6-b5bf-4634-8983-82414bd11028",
    mainCategoryId: "9f8ef570-3ab7-4f5e-86ef-87041211c4d5",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1778922283909-c0079c6effd21668883ec8f07b22f3bc.webp",
    title: { en: "All Tobacco Product ", gu: "All ટોબેકો પ્રોડક્ટ \t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t", hn: "All टोबैको प्रोडक्ट " },
    description: {},
    position: 6,
    status: "Active",
    isTobacco: true
  },
  {
    id: "ca869211-5acf-4e7d-9c5f-16e4c481ef0a",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779318620510-ba6a59f88de9f51902af152a3002885c.webp",
    title: { en: "Tel", gu: "તેલ ", hn: "तेल " },
    description: {},
    position: 25,
    status: "Active",
    isTobacco: false
  },
  {
    id: "d934eff4-583d-4cbb-b8ef-87e1ca8cb34a",
    mainCategoryId: "47b5d282-9cd2-4656-a695-8c237b4b2bfb",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1778849920084-5d221c4e9e8f66fe2e632a1e623608f6.webp",
    title: { en: "Sadi bidi", gu: "સાદી સિગારેટ ", hn: "सादी सिगरेट " },
    description: {},
    position: 1,
    status: "Active",
    isTobacco: true
  },
  {
    id: "daa1b92d-ed3a-42ed-ac30-fb667333f84a",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779128206038-38856683e31ee3511ff7e473aabf250c.webp",
    title: { en: "Colget", gu: "કોલગેટ ", hn: "कोलगेट " },
    description: {},
    position: 21,
    status: "Active",
    isTobacco: false
  },
  {
    id: "dac43efc-431d-47bb-90ae-36d092247b75",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779011517656-2e3b984d03ffda06be094d1b1fddd522.webp",
    title: { en: "All General Product ", gu: "All જનરલ પ્રોડક્ટ ", hn: "All जनरल प्रोडक्ट " },
    description: {},
    position: 13,
    status: "Active",
    isTobacco: false
  },
  {
    id: "e1beee1c-27dd-40a9-8b67-6b1df5b91382",
    mainCategoryId: "85ac7df8-d796-4bfb-919b-0db32b529bdb",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779369981675-ed6a712958ef936d5f5f0b7836b267ee.webp",
    title: { en: "Toast", gu: "ટોસ્ટ", hn: "टोस्ट" },
    description: {},
    position: 27,
    status: "Active",
    isTobacco: false
  },
  {
    id: "fdede9be-91b9-4686-9b3f-85f07b5fd4dd",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779318593222-1010330e3eb9bd987bcfec8b712bc9ee.webp",
    title: { en: "Shampoo ", gu: "શેમ્પૂ ", hn: "शैम्पू " },
    description: {},
    position: 24,
    status: "Active",
    isTobacco: false
  },
  {
    id: "fedfa709-73d6-44ca-b7f2-527873a278e4",
    mainCategoryId: "e3e0e795-e272-4b87-9f8c-82fd8122634d",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779022034895-99a8d85ee0a850786b54a8f5763e955f.webp",
    title: { en: "Other Choclate ", gu: "Other ચોકલેટ ", hn: "Other चोकलेट" },
    description: {},
    position: 16,
    status: "Active",
    isTobacco: false
  }
];

const seed = async () => {
    try {
        await sequelize.authenticate();
        console.log('[Seed] Database connected successfully.');
        
        console.log('[Seed] Seeding main categories...');
        for (const cat of mainCategories) {
            await MainCategory.upsert(cat);
        }
        console.log('[Seed] Main categories seeded successfully.');

        console.log('[Seed] Seeding sub categories...');
        for (const sub of subCategories) {
            await SubCategory.upsert(sub);
        }
        console.log('[Seed] Sub categories seeded successfully.');
        
        console.log('[Seed] All categories and subcategories imported successfully ✓');
        process.exit(0);
    } catch (error) {
        console.error('[Seed Error] Failed to seed:', error.message);
        process.exit(1);
    }
};

seed();
