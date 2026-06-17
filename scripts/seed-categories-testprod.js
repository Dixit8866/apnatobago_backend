import sequelize from '../config/db.js';
import MainCategory from '../models/superadmin-models/MainCategory.js';
import SubCategory from '../models/superadmin-models/SubCategory.js';
import CompanyCategory from '../models/superadmin-models/CompanyCategory.js';

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
    title: { en: "Cigret ", gu: "સિગરેટ ", hn: "સિગરેટ " },
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
    title: { en: "Khari", gu: "ખારી ", hn: "खારી" },
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
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780225949789-06355e4facf19e300f6e0ff3956d06fb.webp",
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
    title: { en: "Colget", gu: "કોલગેટ ", hn: "કોલગેટ " },
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
    title: { en: "Toast", gu: "ટોસ્ટ", hn: "ટોસ્ટ" },
    description: {},
    position: 27,
    status: "Active",
    isTobacco: false
  },
  {
    id: "fdede9be-91b9-4686-9b3f-85f07b5fd4dd",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779318593222-1010330e3eb9bd987bcfec8b712bc9ee.webp",
    title: { en: "Shampoo ", gu: "શેમ્પૂ ", hn: "શેમ્પૂ " },
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

const companyCategories = [
  {
    id: "0002df13-4fd4-4de3-80c2-8d55d11a1214",
    mainCategoryId: "47b5d282-9cd2-4656-a695-8c237b4b2bfb",
    subCategoryId: "8a34d118-6aaa-4f13-9dd3-3181c00ce609",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780223838826-e204ecaf956b626236327a1eacc06ca5.webp",
    title: { en: "Classic", gu: "કલાસસિંક", hn: "क्लासिक" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "00b2e2f3-7f5e-4484-9565-8bd184b7f921",
    mainCategoryId: "29c2297c-ed38-4c6d-bffb-1aaddedc70e7",
    subCategoryId: "b6599734-1f3e-4b90-b89e-fc4324bfbc2e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779322919535-79636cbc16f8e69ca52b307df2d6b35c.webp",
    title: { en: "Ashiki ", gu: "આશિકી ", hn: "आशिकी " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "03269caa-ba60-4658-8bcb-65b50646eba6",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    subCategoryId: "dac43efc-431d-47bb-90ae-36d092247b75",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779011595746-89a7c6f163b2b7edfc28e91626b21786.webp",
    title: { en: "Eno ", gu: "ઇનો ", hn: "इनो" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "0839c0df-b053-4b7b-917d-876398e9b378",
    mainCategoryId: "ddaaf65c-bf04-48eb-84bf-0000d47e784e",
    subCategoryId: "a9e3d94e-ee97-4378-b103-c0e60a24257b",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780230744955-c197e2eff8fedccccdb92b292adebe6e.webp",
    title: { en: "Parle ", gu: "પારલે", hn: "पारले" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "0ee0c3dc-b79a-442e-b134-f269f324acfb",
    mainCategoryId: "85ac7df8-d796-4bfb-919b-0db32b529bdb",
    subCategoryId: "a4cdce88-126a-42b5-a6f4-f27e9d29afbc",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779006430577-1a813eeb90aac8cdb8b4bc73ed177cbf.webp",
    title: { en: "Sunfest", gu: "સનફેસ્ટ", hn: "सनફેસ્ટ " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "120d902b-a7fe-4824-836a-9add224e9590",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    subCategoryId: "fdede9be-91b9-4686-9b3f-85f07b5fd4dd",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779319135762-2c2cedb606e31fe495ea1f7238a6937d.webp",
    title: { en: "Vatika ", gu: "વાટિકા ", hn: "वाटिका " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "1401f91a-7621-4fdf-a3c0-8b8f0a0ecf27",
    mainCategoryId: "29c2297c-ed38-4c6d-bffb-1aaddedc70e7",
    subCategoryId: "b6599734-1f3e-4b90-b89e-fc4324bfbc2e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1778921233612-521b5169e93ba9cfc6be28c0aa591769.webp",
    title: { en: "Vimal", gu: "વિમલ", hn: "विमल" },
    description: {},
    position: 0,
    status: "Deleted",
    isTobacco: true
  },
  {
    id: "181bad35-9101-4513-8c9b-759082abfd29",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    subCategoryId: "60c72c0f-17dd-44a0-8891-bd40cbe20cfb",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779127571492-a7d2f4d88159b195450b4f458a4a5656.webp",
    title: { en: "Godfather ", gu: "ગોડફાધર ", hn: "गोडफाधर " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "1866f84f-7dc9-48db-a070-c58d2b9c288c",
    mainCategoryId: "957aefc5-ee15-40b9-9709-8d148f0be855",
    subCategoryId: "57b13a13-c815-49fe-89f8-c8fed893e5d1",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780225544427-4ca014b3b7943f2ea7c37526150d124c.webp",
    title: { en: "Bagban ", gu: "બાગબાન ", hn: "बागबान" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "1a034610-3be4-4ca7-926e-401846e6c566",
    mainCategoryId: "ddaaf65c-bf04-48eb-84bf-0000d47e784e",
    subCategoryId: "87ca780e-1292-44fc-a403-31fe2784ef6d",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780230544548-370f5f5cc23df987f7374ebb34d85e45.webp",
    title: { en: "String", gu: "સ્ટ્રીંગ", hn: "स्ट्रिंग" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "1a253bbc-7442-485b-8d49-777d929f06ea",
    mainCategoryId: "957aefc5-ee15-40b9-9709-8d148f0be855",
    subCategoryId: "30fc9431-1658-44b0-a249-08a88d8f8839",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780225949789-06355e4facf19e300f6e0ff3956d06fb.webp",
    title: { en: "Asha", gu: "આશા", hn: "आशा" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "1a51e2e3-aafe-4b90-9d7b-20a4c96e8805",
    mainCategoryId: "47b5d282-9cd2-4656-a695-8c237b4b2bfb",
    subCategoryId: "d934eff4-583d-4cbb-b8ef-87e1ca8cb34a",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780225395271-9d45f2d1b7c1de586eed4bcef5d55542.webp",
    title: { en: "Raja Bidi", gu: "રાજા બીડી ", hn: "राजा बीड़ी " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "2059c52b-8868-40c7-baab-b6753e19b435",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    subCategoryId: "60c72c0f-17dd-44a0-8891-bd40cbe20cfb",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779127563924-310d5d9d71f46f462c303620da84a014.webp",
    title: { en: "Opel", gu: "ઓપેલ ", hn: "ओपेल " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "206efd2a-2f66-409c-b86a-254e070a4dd9",
    mainCategoryId: "ddaaf65c-bf04-48eb-84bf-0000d47e784e",
    subCategoryId: "87ca780e-1292-44fc-a403-31fe2784ef6d",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780230918441-253f14e87d756318e3119da5b6a4a7ad.webp",
    title: { en: "Coca Cola", gu: "કોકા કોલા", hn: "कोका कोला" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "217d167c-7500-4463-9aa5-b456911de18b",
    mainCategoryId: "47b5d282-9cd2-4656-a695-8c237b4b2bfb",
    subCategoryId: "d934eff4-583d-4cbb-b8ef-87e1ca8cb34a",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780224964045-9184119a511f082eae41fda6f9bfa58f.webp",
    title: { en: "Charbhai Bidi", gu: "ચારભાઈ બીડી", hn: "चारभाई बीड़ी" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "21aae46f-0bc8-4be8-857e-78f293b1c7db",
    mainCategoryId: "9f8ef570-3ab7-4f5e-86ef-87041211c4d5",
    subCategoryId: "c9e0d1e6-b5bf-4634-8983-82414bd11028",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780229995557-3eb9a94e54427152b37b894c89dbf2b6.webp",
    title: { en: "All Tobacco Product ", gu: "All ટોબેકો પ્રોડક્ટ \t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t", hn: "All टोबैको प्रोडक्ट " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "2418cd00-6268-4d0a-bbc1-cc0cc9af0ff5",
    mainCategoryId: "957aefc5-ee15-40b9-9709-8d148f0be855",
    subCategoryId: "30fc9431-1658-44b0-a249-08a88d8f8839",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780225771999-7ffbd6425ba4b9a8f480c082a4f186d6.webp",
    title: { en: "Budhalal", gu: "બુધાલાલ", hn: "बुधलाल" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "27e34d5f-e022-43ad-9190-8ba466a32501",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    subCategoryId: "ca869211-5acf-4e7d-9c5f-16e4c481ef0a",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779318712134-95033c17b93ad940182dfeb4707e3851.webp",
    title: { en: "Bajaj Almond ", gu: "બજાજ અલમોન્ડ ", hn: "बजाज आलमंड " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "28959d2b-e3f8-4ada-a85b-4738036e2250",
    mainCategoryId: "e3e0e795-e272-4b87-9f8c-82fd8122634d",
    subCategoryId: "fedfa709-73d6-44ca-b7f2-527873a278e4",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780230016538-3fa4db9254178911f3beb8879f50a952.webp",
    title: { en: "Other Choclate ", gu: "Other ચોકલેટ", hn: "Other चॉक्लेट" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "2be81fa6-ae9d-498b-8d7c-05158a4d24c7",
    mainCategoryId: "181dc27a-0b4d-4bbd-803a-4639dcd5418e",
    subCategoryId: "1c8790fd-e029-497e-b4b1-89bc46eeae17",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780229945509-2ee4c4d9d87f710cb7e551e5497b9417.webp",
    title: { en: "All Mukhwas Product ", gu: "All મુખવાસ પ્રોડક્ટ ", hn: "All मुखवास प्रोडक्ट " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "2c8f3d37-54e2-429d-bb87-a1ae054f5c1e",
    mainCategoryId: "47b5d282-9cd2-4656-a695-8c237b4b2bfb",
    subCategoryId: "d934eff4-583d-4cbb-b8ef-87e1ca8cb34a",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780224829437-28071d7d6d073231897f283b9875cb2b.webp",
    title: { en: "Special Bidi", gu: "સ્પેશ્યલ બીડી", hn: "स्पेशल बीड़ी" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "2dacfe49-786f-492b-a808-68abf9b8ac2c",
    mainCategoryId: "29c2297c-ed38-4c6d-bffb-1aaddedc70e7",
    subCategoryId: "b6599734-1f3e-4b90-b89e-fc4324bfbc2e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1778920968078-09063f988a824a7a330113330c37856b.webp",
    title: { en: "Rajnigandha", gu: "રજનીગંધા", hn: "रजनीगंधा" },
    description: {},
    position: 0,
    status: "Deleted",
    isTobacco: true
  },
  {
    id: "35366c97-7915-4a77-950e-a97b2e80ae51",
    mainCategoryId: "957aefc5-ee15-40b9-9709-8d148f0be855",
    subCategoryId: "30fc9431-1658-44b0-a249-08a88d8f8839",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780226064955-be28cb5527a2c1242d42f36f795b8666.webp",
    title: { en: "Pantharpuri", gu: "પન્થરપુરી", hn: "पंठरपुरी" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "3605e102-11a0-4bf7-80b8-4ffd6c6be7a1",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    subCategoryId: "fdede9be-91b9-4686-9b3f-85f07b5fd4dd",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779319011619-4c7be4ba84a415767e8f35a166b126f5.webp",
    title: { en: "Clinic Plus ", gu: "ક્લિનિક પ્લસ ", hn: "क्लिनिक प्लस " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "37c53940-d3de-4250-a2f5-962d9605d89f",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    subCategoryId: "dac43efc-431d-47bb-90ae-36d092247b75",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779317297225-4e512daa2d94f3ee160c4d1a4c3b45db.webp",
    title: { en: "All Janral Product ", gu: "All જનરલ પ્રોડક્ટ ", hn: "All جنرل प्रोडक्ट " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "37c6430c-21e8-435f-a662-b5daff0e9342",
    mainCategoryId: "ddaaf65c-bf04-48eb-84bf-0000d47e784e",
    subCategoryId: "87ca780e-1292-44fc-a403-31fe2784ef6d",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780230989651-4d6c37ca241552b4c37d89df0d954c70.webp",
    title: { en: "Redbull", gu: "રેડબુલ", hn: "रेडबुल" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "38df7185-2ee6-432a-9af6-0329dd986f60",
    mainCategoryId: "85ac7df8-d796-4bfb-919b-0db32b529bdb",
    subCategoryId: "a1466b69-4d9b-48a9-a7b2-46ac106cd07b",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779005974767-b1f158a7bf2e1174de2c6803397d55b2.webp",
    title: { en: "Britania ", gu: "બ્રિટાનિયા", hn: "ब्रितानिआ" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "38eedda3-070f-4515-afaa-9942a734cc2d",
    mainCategoryId: "e3e0e795-e272-4b87-9f8c-82fd8122634d",
    subCategoryId: "a76e1f82-411c-4d22-b706-095734df5f4d",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779022220274-e7a97e079dd66713c766075f1ca0551f.webp",
    title: { en: "Boomer", gu: "બૂમર", hn: "बूमर" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "3bd6d4bd-5c7e-46ca-a9a6-5846e2876bd5",
    mainCategoryId: "29c2297c-ed38-4c6d-bffb-1aaddedc70e7",
    subCategoryId: "b6599734-1f3e-4b90-b89e-fc4324bfbc2e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779023881014-5a7018d36fa736c576484b462b2bbab3.webp",
    title: { en: "R.M.D", gu: "આર.એમ.ડી", hn: "आर.ऐम .डी" },
    description: {},
    position: 0,
    status: "Deleted",
    isTobacco: true
  },
  {
    id: "3bee6045-f154-4b2c-8824-fe7322abf5bc",
    mainCategoryId: "e3e0e795-e272-4b87-9f8c-82fd8122634d",
    subCategoryId: "96233cb1-5457-44bd-ad41-d57c8afaafd4",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779022178358-3d4c3968766335b53cb5345299122b63.webp",
    title: { en: "Cadbury ", gu: "કેડબરી", hn: "कैडबरी" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "3fd36f4f-b3b8-43e2-a3d9-7fbee4a11761",
    mainCategoryId: "29c2297c-ed38-4c6d-bffb-1aaddedc70e7",
    subCategoryId: "b6599734-1f3e-4b90-b89e-fc4324bfbc2e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779023638313-345bc2630d087530231b9ff8f7580aac.webp",
    title: { en: "Directoer ", gu: "ડાઈરેક્ટર ", hn: "डायरेक्टर" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "411a308d-9c09-4bf9-a791-dbb3313e890b",
    mainCategoryId: "29c2297c-ed38-4c6d-bffb-1aaddedc70e7",
    subCategoryId: "b6599734-1f3e-4b90-b89e-fc4324bfbc2e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779023687239-56dc001132ed82be0fae67d1dbbcb115.webp",
    title: { en: "Mahek", gu: "મહેક", hn: "महक" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "47b8b340-caf0-45d0-aef9-999daee97fbf",
    mainCategoryId: "47b5d282-9cd2-4656-a695-8c237b4b2bfb",
    subCategoryId: "8a34d118-6aaa-4f13-9dd3-3181c00ce609",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780223846429-af2d43e99e96f7a9fad2ca25e9c995d8.webp",
    title: { en: "Goldflack", gu: "ગોલ્ડફ્લેક", hn: "गोल्डफ्लेक" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "49a0d991-f28d-4de4-bd14-3c6d048bbd52",
    mainCategoryId: "e3e0e795-e272-4b87-9f8c-82fd8122634d",
    subCategoryId: "fedfa709-73d6-44ca-b7f2-527873a278e4",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779022117495-7eeda3a7df3c1c86078ac2a51a018b35.webp",
    title: { en: "Alpenliebe ", gu: "અલ્પેનલિએબે", hn: "अल्पेंलिएबे" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "4aacd010-64d0-4de2-a4a7-31389121482b",
    mainCategoryId: "29c2297c-ed38-4c6d-bffb-1aaddedc70e7",
    subCategoryId: "b6599734-1f3e-4b90-b89e-fc4324bfbc2e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779329461837-97c50413bb524380cb578ed2bb41e299.webp",
    title: { en: "Jafri ", gu: "જાફરી", hn: "जाफरी" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "4b47ad84-8cde-457c-b221-899d5df2e8ed",
    mainCategoryId: "29c2297c-ed38-4c6d-bffb-1aaddedc70e7",
    subCategoryId: "b6599734-1f3e-4b90-b89e-fc4324bfbc2e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779028453382-f8c33da4658ed5a37ed38b9dbf7664f8.webp",
    title: { en: "Madhu", gu: "મધુ", hn: "मधु" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "4b5d2b0e-c55f-4c6c-94e1-0b97ae565c08",
    mainCategoryId: "957aefc5-ee15-40b9-9709-8d148f0be855",
    subCategoryId: "30fc9431-1658-44b0-a249-08a88d8f8839",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780225845763-12a20d8b7369724f7620f4c58efa05af.webp",
    title: { en: "Miraj ", gu: "મિરાજ ", hn: "मिराज " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "4b6a7462-1309-47ee-ab69-60171530c495",
    mainCategoryId: "29c2297c-ed38-4c6d-bffb-1aaddedc70e7",
    subCategoryId: "b6599734-1f3e-4b90-b89e-fc4324bfbc2e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779023904828-c8f4a838da3a499642a6cb746e795f3b.webp",
    title: { en: "RMD", gu: "RMD", hn: "RMD" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "51555036-039e-4f56-89aa-d357549990f3",
    mainCategoryId: "e3e0e795-e272-4b87-9f8c-82fd8122634d",
    subCategoryId: "fedfa709-73d6-44ca-b7f2-527873a278e4",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779022390640-72eea6d82d1924216eb8d6331a3775a0.webp",
    title: { en: "Tic Tic", gu: "ટીક ટીક", hn: "टिक  टिक" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "58017df4-dc8b-4cd4-9b39-c138aeba28c7",
    mainCategoryId: "ddaaf65c-bf04-48eb-84bf-0000d47e784e",
    subCategoryId: "87ca780e-1292-44fc-a403-31fe2784ef6d",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780230870046-477ef548fdd4aab647b0ca03924cd123.webp",
    title: { en: "Campa ", gu: "કેમ્પા ", hn: "कैम्पा" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "6060e05a-2026-4fe1-82cb-22bf23090b00",
    mainCategoryId: "47b5d282-9cd2-4656-a695-8c237b4b2bfb",
    subCategoryId: "8a34d118-6aaa-4f13-9dd3-3181c00ce609",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780223875247-b20032da1ddc5b75fcabda29f898cc31.webp",
    title: { en: "Total", gu: "ટોતલ", hn: "टोटल" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "6290308f-2ed8-4dfb-a3e8-1f9730298622",
    mainCategoryId: "29c2297c-ed38-4c6d-bffb-1aaddedc70e7",
    subCategoryId: "b6599734-1f3e-4b90-b89e-fc4324bfbc2e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779332944594-67b60f2d892249e8a28a36cce97ceb7a.webp",
    title: { en: "Rajniwas ", gu: "રાજનિવાસ ", hn: "રાજનિવાસ " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "62fdb02c-8f96-4c95-b90a-6b59680377c9",
    mainCategoryId: "e3e0e795-e272-4b87-9f8c-82fd8122634d",
    subCategoryId: "fedfa709-73d6-44ca-b7f2-527873a278e4",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779022363256-35862dde6dc827ecab5f26fb391d3c14.webp",
    title: { en: "Mentos", gu: "મેન્ટોસ", hn: "मेन्टोस" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "673335d5-70cd-4e2d-b54b-4b7c2eb93830",
    mainCategoryId: "47b5d282-9cd2-4656-a695-8c237b4b2bfb",
    subCategoryId: "d934eff4-583d-4cbb-b8ef-87e1ca8cb34a",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780225244507-6e9343559abb2cc508b9acf8a98f7325.webp",
    title: { en: "Vishal Bidi", gu: "વિશાલ બીડી ", hn: "વિશાલ બીડી " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "67e13350-4fc4-4de7-a638-569f03852456",
    mainCategoryId: "47b5d282-9cd2-4656-a695-8c237b4b2bfb",
    subCategoryId: "8a34d118-6aaa-4f13-9dd3-3181c00ce609",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780223832297-60b44570432926ee45efd7efd5c190ef.webp",
    title: { en: "Marbolo", gu: "મારબોલો", hn: "मारबोलो" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "697aaf17-2dd6-4a4d-901b-2af437529804",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    subCategoryId: "26620d41-b103-43b1-a5f0-521852931c70",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779235680498-30d7b1dae9d50425bf10e79f570f2fd7.webp",
    title: { en: "Santoor ", gu: "સંતૂર ", hn: "संतूर " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "74bde913-ac7d-4c98-9a65-42ee9b2561eb",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    subCategoryId: "26620d41-b103-43b1-a5f0-521852931c70",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779236135237-e15f3b2ba0119a7f4e77ddeeff52a28a.webp",
    title: { en: "Nirma", gu: "નિરમા ", hn: "निरમા " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "7650ef5c-9330-494f-b6f8-cbbe30f29db9",
    mainCategoryId: "29c2297c-ed38-4c6d-bffb-1aaddedc70e7",
    subCategoryId: "b6599734-1f3e-4b90-b89e-fc4324bfbc2e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779023917796-dceba70f683046672ae8fae9b8e20189.webp",
    title: { en: "Baba Navratn ", gu: "બાબા  નવરત્ન", hn: "बाबा नवरत्न" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "77dcc55c-3aed-4a68-8743-5d02ba480cf2",
    mainCategoryId: "47b5d282-9cd2-4656-a695-8c237b4b2bfb",
    subCategoryId: "d934eff4-583d-4cbb-b8ef-87e1ca8cb34a",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780225140636-59bbeacd72d168d35ec2233a5b016b89.webp",
    title: { en: "Shivaji Bidi", gu: "શિવાજી બીડી ", hn: "શિવાજી બીડી " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "7958e92e-00e5-4914-9df2-ac592954d1a0",
    mainCategoryId: "47b5d282-9cd2-4656-a695-8c237b4b2bfb",
    subCategoryId: "8a34d118-6aaa-4f13-9dd3-3181c00ce609",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780223233353-46f0894cccebefefe08c7ebac91684fd.webp",
    title: { en: "Forsquare", gu: "ફોરસ્કવેર", hn: "फोरस्क्वेर" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "7b2264e7-e90a-480a-b455-b231e6ba965c",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    subCategoryId: "26620d41-b103-43b1-a5f0-521852931c70",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779235757784-80b7693dfa97a653391cc0446e81608e.webp",
    title: { en: "Lifeboy ", gu: "લાઈફબોય ", hn: "लाइफ्बोय " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "861e81fa-ab02-4340-8737-79605a7f147b",
    mainCategoryId: "85ac7df8-d796-4bfb-919b-0db32b529bdb",
    subCategoryId: "a1466b69-4d9b-48a9-a7b2-46ac106cd07b",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779005940642-7b73ea00ea9ded67b4b222639b272cbb.webp",
    title: { en: "Parle ", gu: "પારલે  ", hn: "पारले" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "86d5bcc1-8d1a-4666-aeac-ee58aa05fc30",
    mainCategoryId: "29c2297c-ed38-4c6d-bffb-1aaddedc70e7",
    subCategoryId: "b6599734-1f3e-4b90-b89e-fc4324bfbc2e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779028408720-b94cdbe921f78fbaf17c0b7c34a132a3.webp",
    title: { en: "Baba ", gu: "બાબા", hn: "बाबा" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "88b0da0a-7b75-4e68-aaaa-f6f05c0008b9",
    mainCategoryId: "ddaaf65c-bf04-48eb-84bf-0000d47e784e",
    subCategoryId: "87ca780e-1292-44fc-a403-31fe2784ef6d",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780230621466-083bb600b7ecdeb993ae583269752bcc.webp",
    title: { en: "Bagira", gu: "બગીરા", hn: "बगिरा" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "8e759cee-bb6f-4d01-92ca-0dedaf16d9cb",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    subCategoryId: "26620d41-b103-43b1-a5f0-521852931c70",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779236232667-5f5db637ef2a3865e72c20541b541f60.webp",
    title: { en: "No.1 Godrej", gu: "No.1 ગોધરેજ ", hn: "No.1 गोधरेज " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "913efc95-2440-474a-b878-89cb88f9b61f",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    subCategoryId: "dac43efc-431d-47bb-90ae-36d092247b75",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779318957773-553351ce529cc46055f7eea8a75e8fe6.webp",
    title: { en: "Favikik ", gu: "ફેવિકિક ", hn: "ફેવિકિક " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "92fbf4db-90ea-4de3-8481-65103c3618dc",
    mainCategoryId: "29c2297c-ed38-4c6d-bffb-1aaddedc70e7",
    subCategoryId: "b6599734-1f3e-4b90-b89e-fc4324bfbc2e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779023558341-045e7aeb9b6e8d2ad228aef0d624d2df.webp",
    title: { en: "Vimal", gu: "વિમલ", hn: "विमल" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "93d83575-97c1-4011-809c-94f2d2fb8d85",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    subCategoryId: "26620d41-b103-43b1-a5f0-521852931c70",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779236104470-b97924bf6a1f7e84d05e7aac3c1d8108.webp",
    title: { en: "Detol", gu: "ડેટોલ ", hn: "डेटोल " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "9875d5a7-1c51-467f-86d6-3257934174a4",
    mainCategoryId: "ddaaf65c-bf04-48eb-84bf-0000d47e784e",
    subCategoryId: "a9e3d94e-ee97-4378-b103-c0e60a24257b",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780230074312-f6eeb91799f67886deb4bc04bde11a68.webp",
    title: { en: "Other Cold Drinks", gu: "Other કોલ્ડડ્રિંક્સ ", hn: "Other कोल्डड्रिंक्स " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "997f5225-0024-42b7-a78a-a18e6e10dcad",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    subCategoryId: "a98d3877-dcda-4cca-92ad-8e74d8ab854e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779125161649-cd043f9c908442a1c01f5461b5999714.webp",
    title: { en: "Jivaraj", gu: "જીવરાજ ", hn: "जीवराज " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "9d0fac6a-44d2-4562-8810-82be5a9b198b",
    mainCategoryId: "47b5d282-9cd2-4656-a695-8c237b4b2bfb",
    subCategoryId: "8a34d118-6aaa-4f13-9dd3-3181c00ce609",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780223868172-817ea242f803fc04b82ec3214593b594.webp",
    title: { en: "Bristol", gu: "બ્રિસ્ટોલ ", hn: "ब्रिस्टोल" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "9f9af591-410e-44e4-a555-98eb9c431158",
    mainCategoryId: "ddaaf65c-bf04-48eb-84bf-0000d47e784e",
    subCategoryId: "63e2c651-62ae-4d0d-843b-0d70d3ee7a4e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780230271722-58ecfd03bebb7850e93d7ea22ae288fd.webp",
    title: { en: "Nestle", gu: "नेस्टले", hn: "नेस्ले " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "a00af1c7-6f28-4c5c-830c-484a637b6b60",
    mainCategoryId: "ddaaf65c-bf04-48eb-84bf-0000d47e784e",
    subCategoryId: "a9e3d94e-ee97-4378-b103-c0e60a24257b",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780230401087-72820dc5d4be58c663962f4a4c8c1c7e.webp",
    title: { en: "Sosyo", gu: "સોસ્યો", hn: "सोस्यो" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "a38d3f98-6fe3-4aca-a925-f43582403b4e",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    subCategoryId: "26620d41-b103-43b1-a5f0-521852931c70",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779284883624-0e624c6879abc2ad0c005b9dfb910ff5.webp",
    title: { en: "Vivel ", gu: "વિવેલ ", hn: "विवेल " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "a39f3bd2-e278-42f6-b6cc-72efa8648386",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    subCategoryId: "fdede9be-91b9-4686-9b3f-85f07b5fd4dd",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779318751301-c9d5a3a840244e313b7fde10abc97091.webp",
    title: { en: "Dove", gu: "દવ ", hn: "દવ " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "aba36983-3c0f-40de-9638-c528f6f0c6e5",
    mainCategoryId: "29c2297c-ed38-4c6d-bffb-1aaddedc70e7",
    subCategoryId: "b6599734-1f3e-4b90-b89e-fc4324bfbc2e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779023535666-6937bd539d3c4734da9d5652e4ee04d4.webp",
    title: { en: "Rajnigandha", gu: "રજનીગંધા", hn: "रजनीगंधा" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "ac5b12ce-fbc1-44b2-bbcd-a22ba16ad820",
    mainCategoryId: "ddaaf65c-bf04-48eb-84bf-0000d47e784e",
    subCategoryId: "a9e3d94e-ee97-4378-b103-c0e60a24257b",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780230447133-972f432d876206a3012c45944da15806.webp",
    title: { en: "Davat ", gu: "દાવત", hn: "दावत" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "b0e69be1-d5ec-49b1-b294-a2edb84f3a18",
    mainCategoryId: "29c2297c-ed38-4c6d-bffb-1aaddedc70e7",
    subCategoryId: "b6599734-1f3e-4b90-b89e-fc4324bfbc2e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779023581472-9bdf6120fd3334d46971bd316cbc8662.webp",
    title: { en: "Signature ", gu: "સિગ્નેચર", hn: "સિગ્નેચર" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "b28ef2f0-806c-4487-ac44-01cbc1fc32e8",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    subCategoryId: "26620d41-b103-43b1-a5f0-521852931c70",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779236161409-3db3956326d45ca21382f851205620a7.webp",
    title: { en: "Lux", gu: "લક્સ ", hn: "લક્સ " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "b3727512-25ab-4a32-9695-e4f6caba76bb",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    subCategoryId: "fdede9be-91b9-4686-9b3f-85f07b5fd4dd",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779318902251-a43a87d445311df6281a2d24328c1c76.webp",
    title: { en: "Head & Sholder ", gu: "હેડ & શોલ્ડર ", hn: "હેડ & શોલ્ડર " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "bdda2952-16b5-479b-b157-b631ec9ae367",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    subCategoryId: "96b0e3a0-3b33-49b8-af34-ff83a7604283",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779309948797-b8f2981e39157099e29b1d28282909f6.webp",
    title: { en: "Nargis ", gu: "નારગીસ", hn: "नारगीस" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "bece3aef-e6bb-40a8-ad46-94d55ee4b13b",
    mainCategoryId: "ddaaf65c-bf04-48eb-84bf-0000d47e784e",
    subCategoryId: "87ca780e-1292-44fc-a403-31fe2784ef6d",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780230321085-9a3d7595526e8a21cfe2a0e5a2619f9b.webp",
    title: { en: "Monster", gu: "મોન્સ્ટર", hn: "मॉन्स्टर" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "bee50fb4-5e6e-4275-87c8-403fb74a2811",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    subCategoryId: "daa1b92d-ed3a-42ed-ac30-fb667333f84a",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779319070794-1cd2d4698754b05926ec04b3e490898c.webp",
    title: { en: "Closeup ", gu: "કલોસપ", hn: "क्लोज़अप " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "c0d299fd-24fd-4d34-9bb4-c63ebd886c23",
    mainCategoryId: "957aefc5-ee15-40b9-9709-8d148f0be855",
    subCategoryId: "30fc9431-1658-44b0-a249-08a88d8f8839",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780225301803-6097384cf7e3d135be32d86e34dbd658.webp",
    title: { en: "Other Tambakoo ", gu: "Other તમ્બાકૂ ", hn: "Other तम्बाकू " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "c24f21a0-3270-4bfb-99dc-2cee07f9f2b6",
    mainCategoryId: "e3e0e795-e272-4b87-9f8c-82fd8122634d",
    subCategoryId: "a76e1f82-411c-4d22-b706-095734df5f4d",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779022240989-268309b7cd5bd50a1664a704d7baa3a1.webp",
    title: { en: "Happy Dent ", gu: " હેપી ડેન્ટ", hn: "हैप्पी डेंट" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "c2fbcefc-dca7-45af-8819-4ea5227c00f1",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    subCategoryId: "ca869211-5acf-4e7d-9c5f-16e4c481ef0a",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779318843560-431189b83bd7063855abe37251256ec8.webp",
    title: { en: "Parachute", gu: "પારચુટે ", hn: "पारचुते" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "c8ae154e-0d2c-40a0-ad0f-5e4e5fe4cfe6",
    mainCategoryId: "ddaaf65c-bf04-48eb-84bf-0000d47e784e",
    subCategoryId: "a9e3d94e-ee97-4378-b103-c0e60a24257b",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780230676642-c1ac493cd586968f60af8443459e3cef.webp",
    title: { en: "Fenta", gu: "ફેન્ટા", hn: "फेंटा" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "cb78126d-a173-4355-af15-cda433b95cf8",
    mainCategoryId: "29c2297c-ed38-4c6d-bffb-1aaddedc70e7",
    subCategoryId: "b6599734-1f3e-4b90-b89e-fc4324bfbc2e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779023726792-a1eebaeb76b4981f65d82dab345dd9ab.webp",
    title: { en: "Rajshree ", gu: "રાજશ્રી", hn: "રાજશ્રી" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "cc6c1058-eab3-483c-bf56-fc483876d652",
    mainCategoryId: "47b5d282-9cd2-4656-a695-8c237b4b2bfb",
    subCategoryId: "8a34d118-6aaa-4f13-9dd3-3181c00ce609",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780223861210-28345d2b83cce4de36800cac6d6f665a.webp",
    title: { en: "American Club", gu: "અમેરિકન ક્લબ", hn: "अमेरिकन क्लब" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "d11a0df7-f100-43d5-856d-a3cd9f94abcc",
    mainCategoryId: "e3e0e795-e272-4b87-9f8c-82fd8122634d",
    subCategoryId: "fedfa709-73d6-44ca-b7f2-527873a278e4",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779022147742-748197acca7cd6ef6a7a3f4735e8949c.webp",
    title: { en: "T-Gon", gu: "T-Gon", hn: "T-Gon" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "d811e3f2-a4a6-4cff-9c44-84e77c24d1e2",
    mainCategoryId: "29c2297c-ed38-4c6d-bffb-1aaddedc70e7",
    subCategoryId: "b6599734-1f3e-4b90-b89e-fc4324bfbc2e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779023658741-a7b88d3263b88650d60dac9f7c5b40fe.webp",
    title: { en: "Shikher ", gu: "શિખર", hn: "शिखर" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "d8acf54f-ffc4-42d5-a564-8d5b4c0949cd",
    mainCategoryId: "e3e0e795-e272-4b87-9f8c-82fd8122634d",
    subCategoryId: "fedfa709-73d6-44ca-b7f2-527873a278e4",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779022198379-69b19b995a9e8e33d6a7fdae93362d21.webp",
    title: { en: "Hajmola", gu: "હાજમોલા", hn: "हाजमोला" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "dada52ad-aa1a-4cd5-9213-61fd39f076a9",
    mainCategoryId: "47b5d282-9cd2-4656-a695-8c237b4b2bfb",
    subCategoryId: "8a34d118-6aaa-4f13-9dd3-3181c00ce609",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780224374985-2c28de2a92e93c42d6f7819f4738606a.webp",
    title: { en: "Other Cigaret ", gu: "Other સિગારેટ ", hn: "Other सिगरेट " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "dc183482-35e3-4970-a731-9f6ce81dc817",
    mainCategoryId: "29c2297c-ed38-4c6d-bffb-1aaddedc70e7",
    subCategoryId: "b6599734-1f3e-4b90-b89e-fc4324bfbc2e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779226595133-fa97ae1570360d22acb0a07a79c1b07f.webp",
    title: { en: "Karamchand ", gu: "કરમચંદ ", hn: "करમચંદ " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "dd057e6e-3cbb-42a9-83be-5cfe51d30f8e",
    mainCategoryId: "85ac7df8-d796-4bfb-919b-0db32b529bdb",
    subCategoryId: "a4cdce88-126a-42b5-a6f4-f27e9d29afbc",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779006367777-bd73aad520fcd9f44512dd724a6a763b.webp",
    title: { en: "Oreo", gu: "ઓરિઓ", hn: "ઓરિઓ " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "dfc4bd88-9929-4b2d-a8d7-e431d084b587",
    mainCategoryId: "29c2297c-ed38-4c6d-bffb-1aaddedc70e7",
    subCategoryId: "b6599734-1f3e-4b90-b89e-fc4324bfbc2e",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779023833571-5451bef170f909f7e5cc9ac84cc3f8c5.webp",
    title: { en: "Tansen ", gu: "તાનસેન", hn: "Tansen " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "ecde5187-aa1e-49d4-8142-e8d852f44c7d",
    mainCategoryId: "ddaaf65c-bf04-48eb-84bf-0000d47e784e",
    subCategoryId: "a9e3d94e-ee97-4378-b103-c0e60a24257b",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780230810287-d9f1c880848d54847ac1a8c2aeeb1ca5.webp",
    title: { en: "Favrito", gu: "ફેવરીતો", hn: "ફેવરીતો" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "ed34edec-ba8b-49cd-b98b-d3f5545efb5b",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    subCategoryId: "fdede9be-91b9-4686-9b3f-85f07b5fd4dd",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779319106494-76b5e7920bed735d58749114645657bd.webp",
    title: { en: "Patanjali ", gu: "પતંજલિ ", hn: "Patanjali " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "ef1083b4-5e2d-4c1d-abd4-dc43adaaf2ac",
    mainCategoryId: "47b5d282-9cd2-4656-a695-8c237b4b2bfb",
    subCategoryId: "8a34d118-6aaa-4f13-9dd3-3181c00ce609",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780223853336-b71ccead21cb3c3b96a5af900690b6bc.webp",
    title: { en: "Stellar", gu: "સ્ટેલર", hn: "स्टेलर" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "ef25565d-b6c9-4fb6-a4b5-e95237ba7279",
    mainCategoryId: "e3e0e795-e272-4b87-9f8c-82fd8122634d",
    subCategoryId: "a76e1f82-411c-4d22-b706-095734df5f4d",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779022337690-37c2afb0e6ca39baa843bb06ebdf42db.webp",
    title: { en: "Centerfresh", gu: "સેન્ટર્ફરેશ", hn: "सेंटरफ्रेश" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "f460b677-9c96-46b8-97f4-53eb752b4054",
    mainCategoryId: "47b5d282-9cd2-4656-a695-8c237b4b2bfb",
    subCategoryId: "8a34d118-6aaa-4f13-9dd3-3181c00ce609",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780223957432-01e7cf61ead85b5e751e7bd63df54664.webp",
    title: { en: "Edition ", gu: "એડિશન", hn: "એડિશન" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: true
  },
  {
    id: "fa402bdb-b8ae-467b-bb4c-a86e94b5ff56",
    mainCategoryId: "ddaaf65c-bf04-48eb-84bf-0000d47e784e",
    subCategoryId: "87ca780e-1292-44fc-a403-31fe2784ef6d",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1780231033598-d56858318a9c4a479fe6a143e9d0f954.webp",
    title: { en: "Hell", gu: "હેલ", hn: "हेल" },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "fb5232dc-8150-4a12-b845-df0184579f95",
    mainCategoryId: "89285db8-02c0-4ec5-980f-4bee6a0402db",
    subCategoryId: "daa1b92d-ed3a-42ed-ac30-fb667333f84a",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779128240958-93c171c22291b1d44caec751328fff7b.webp",
    title: { en: "Colget", gu: "કોલગેટ", hn: "કોલગેટ " },
    description: {},
    position: 0,
    status: "Active",
    isTobacco: false
  },
  {
    id: "fdbb1c6c-ac86-477d-a022-0900c8599dbb",
    mainCategoryId: "85ac7df8-d796-4bfb-919b-0db32b529bdb",
    subCategoryId: "0d9d9bbd-6b49-47fa-80a4-980a7e7aecb0",
    image: "https://apnatobacco.s3.ap-south-1.amazonaws.com/uploads/1779369772711-f1ee97c82584b39a3a084c7b7f6608bb.webp",
    title: { en: "TGB", gu: "TGB", hn: "TGB" },
    description: {},
    position: 0,
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

        console.log('[Seed] Seeding company categories...');
        for (const comp of companyCategories) {
            await CompanyCategory.upsert(comp);
        }
        console.log('[Seed] Company categories seeded successfully.');
        
        console.log('[Seed] All categories, subcategories, and company categories imported successfully ✓');
        process.exit(0);
    } catch (error) {
        console.error('[Seed Error] Failed to seed:', error.message);
        process.exit(1);
    }
};

seed();
