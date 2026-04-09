// ─── Constants ───────────────────────────────────────────────────
const BIN_PATTERNS = [/\bbin\b/i, /\bfill a bag\b/i, /\bglass case\b/i];
const MAX_TXN_DURATION_MS = 30 * 60 * 1000;
const ALL_STORES = ["BL1", "BL2", "BL4", "BL8", "BL12", "BL14"];

// Get today's date and start-of-day timestamp in Eastern Time (all stores are ET)
function getETToday() {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
  const tzParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' }).formatToParts(now);
  const isDST = tzParts.find(p => p.type === 'timeZoneName')?.value === 'EDT';
  const utcOffsetHours = isDST ? 4 : 5;
  const startOfDay = new Date(dateStr + 'T00:00:00Z').getTime() + (utcOffsetHours * 3600000);
  return { dateStr, startOfDay };
}

// L3 (Clover category name) → L2 (rollup category) mapping
const L3_TO_L2 = {
  "BL CONSUMABLES - FOOD - PEPSI": "Consumable Food",
  "BL CONSUMABLES - FOOD - PEPSI CASE PACK": "Consumable Food",
  "FG BL CONSUMABLES - FOOD - BEVERAGES": "Consumable Food",
  "FG BL CONSUMABLES - FOOD - BREAKFAST": "Consumable Food",
  "FG BL CONSUMABLES - FOOD - CANDY": "Consumable Food",
  "FG BL CONSUMABLES - FOOD - CANNED GOODS": "Consumable Food",
  "FG BL CONSUMABLES - FOOD - COFFEE & TEA": "Consumable Food",
  "FG BL CONSUMABLES - FOOD - CONDIMENTS": "Consumable Food",
  "FG BL CONSUMABLES - FOOD - FROZEN": "Consumable Food",
  "FG BL CONSUMABLES - FOOD - PANTRY": "Consumable Food",
  "FG BL CONSUMABLES - FOOD - SINGLES": "Consumable Food",
  "FG BL CONSUMABLES - FOOD - SNACKS": "Consumable Food",
  "FG G CI MIXED CANDY": "Consumable Food",
  "FRONTE PASTA - 10LBS": "Consumable Food",
  "FRONTE PASTA - 5LBS": "Consumable Food",
  "FG BL CONSUMABLES - FOOD - ENERGY DRINKS": "Consumable Food",
  "FG BL CONSUMABLES - FOOD - MIXED BAG CANDY": "Consumable Food",
  "FG BL CONSUMABLES - HBA - ALLERGY/COUGH/FLU": "Consumable HBA",
  "FG BL CONSUMABLES - HBA - COSMETICS": "Consumable HBA",
  "FG BL CONSUMABLES - HBA - FACE": "Consumable HBA",
  "FG BL CONSUMABLES - HBA - HAIRCARE": "Consumable HBA",
  "FG BL CONSUMABLES - HBA - HYGIENE": "Consumable HBA",
  "FG BL CONSUMABLES - HBA - MEDS": "Consumable HBA",
  "FG BL CONSUMABLES - HBA - ORAL": "Consumable HBA",
  "FG BL CONSUMABLES - HBA - PAIN": "Consumable HBA",
  "FG BL CONSUMABLES - HBA - SUNCARE": "Consumable HBA",
  "FG BL CONSUMABLES - HBA - TRAVEL SIZE": "Consumable HBA",
  "FG BL CONSUMABLES - CHEMICALS": "Consumable Other",
  "FG BL CONSUMABLES - HOUSEKEEPING": "Consumable Other",
  "FG BL CONSUMABLES - PAPER": "Consumable Other",
  "FG BL CONSUMABLES - PET": "Consumable Other",
  "BL PAPER - NON INVENTORY": "Consumable Other",
  "FG BL FURNITURE - READY TO ASSEMBLE": "Furniture",
  "FG BL FURNITURE - RTA - CHAIRS": "Furniture",
  "FG BL FURNITURE - RTA - TABLES/STANDS": "Furniture",
  "FG BL FURNITURE - UPHOLSTERY": "Furniture",
  "FG BL FURNITURE - CASEGOODS": "Furniture",
  "FG BL FURNITURE - MATTRESSES": "Furniture",
  "FG BL WAYFAIR": "Furniture",
  "MATTRESS ATLANTA MATTRESSES": "Furniture",
  "BAILEY'S RECLINER FURNITURE": "Furniture",
  "BL STORES - COMPTON'S FURNITURE": "Furniture",
  "FG BL HARDLINES - BABY": "Hardlines",
  "FG BL HARDLINES - ELECTRONICS": "Hardlines",
  "FG BL HARDLINES - GENERAL MERCHANDISE": "Hardlines",
  "FG BL HARDLINES - LUGGAGE": "Hardlines",
  "FG BL HARDLINES - OFFICE PRODUCTS": "Hardlines",
  "FG BL HARDLINES - STORAGE": "Hardlines",
  "FG BL HARDLINES - TOYS": "Hardlines",
  "FG BL HARDLINES - SPORTING GOODS": "Hardlines",
  "FG T BULLSEYE": "Hardlines",
  "APPLIANCES - BL STORES": "Hardlines",
  "Bakers Secret - Kitchen Cooking": "Home",
  "FG BL HAMILTON BEACH": "Home",
  "FG BL HOME - BATH": "Home",
  "FG BL HOME - BEDDING & PILLOWS": "Home",
  "FG BL HOME - HOME DECOR": "Home",
  "FG BL HOME - KITCHEN": "Home",
  "FG BL HOME - RUGS": "Home",
  "BL FOAM PLATE PACKS": "Home",
  "FG BL SEASONAL - CHRISTMAS - CANDY": "Seasonal",
  "FG BL SEASONAL - CHRISTMAS - GM": "Seasonal",
  "FG BL SEASONAL - EASTER - GM": "Seasonal",
  "FG BL SEASONAL - EASTER - CANDY": "Seasonal",
  "FG BL SEASONAL - VALENTINES - CANDY": "Seasonal",
  "FG BL SEASONAL - VALENTINES - GM": "Seasonal",
  "FG BL SEASONAL - BACK TO SCHOOL": "Seasonal",
  "FG BL SEASONAL - HALLOWEEN - GM": "Seasonal",
  "FG BL SEASONAL - HALLOWEEN - CANDY": "Seasonal",
  "FG BL SEASONAL - HALLOWEEN - SINGLES": "Seasonal",
  "FG BL SEASONAL - SPRING/SUMMER": "Seasonal",
  "FG BL SEASONAL - LAWN & GARDEN": "Seasonal",
  "FG BALSAM CHRISTMAS TREES B": "Seasonal",
  "FG COSTUMES": "Seasonal",
  "FG BL SOFTLINES - ACCESSORIES": "Softline - Accessories",
  "FG BL SOFTLINES - APPAREL": "Softline - Apparel",
  "FG BL SOFTLINES - SHOES": "Softline - Shoes",
  "Custom Sales": "Custom Sales",
  "MI Bottle/Can Deposit": "Custom Sales",
  "Refund": "Refund",
  // Additional Clover categories not in original Sheets mapping
  "BL Shoe Event": "Softline - Shoes",
  "Apparel": "Softline - Apparel",
  "Bin Products": "Bin Products",
  "Sku Book Items": "Sku Book Items",
};

// Sku Book items → correct L2 category (by item name)
// These items are categorized as "Sku Book Items" in Clover but belong to different L2s
const SKU_BOOK_TO_L2 = {
  "$10 Boots": "Softline - Shoes",
  "$10 Clearance Furniture": "Furniture",
  "$10 Kids Shoes": "Softline - Shoes",
  "$20 Men's & Women's Shoes": "Softline - Shoes",
  "$3 XMAS": "Seasonal",
  "$30 Athletics Shoes": "Softline - Shoes",
  "$4 Home Decor Sale - 10392": "Home",
  "$4 Bath Sale - 50064": "Home",
  "$4 Kitchen Sale - 10390": "Home",
  "$4 Open Toe Shoe": "Softline - Shoes",
  "$5 XMAS": "Seasonal",
  "$50 Pepsi Can": "Consumable Food",
  "14281 - Diapers $2.50": "Hardlines",
  ".35 Cosmetics": "Consumable HBA",
  "3x5 - 4x6 Rug": "Home",
  "5x8 - 6x9d Rug": "Home",
  "7x9 - 9x12 Rug": "Home",
  "9x12+ Rug": "Home",
  "Adult Apparel $6": "Softline - Apparel",
  "Adult Coat": "Softline - Apparel",
};

const IM_TO_L2 = {
  "10015": "Hardlines",
  "10029": "Softline - Shoes",
  "10031": "Seasonal",
  "10073": "Softline - Shoes",
  "10089": "Softline - Accessories",
  "10103": "Seasonal",
  "10104": "Hardlines",
  "10105": "Hardlines",
  "10106": "Consumable Other",
  "10107": "Hardlines",
  "10138": "Hardlines",
  "10145": "Softline - Shoes",
  "10185": "Hardlines",
  "10209": "Hardlines",
  "10210": "Hardlines",
  "10211": "Hardlines",
  "10212": "Hardlines",
  "10213": "Hardlines",
  "10214": "Hardlines",
  "10215": "Hardlines",
  "10306": "Hardlines",
  "10307": "Home",
  "10311": "Hardlines",
  "10312": "Seasonal",
  "10313": "Seasonal",
  "10314": "Hardlines",
  "10315": "Hardlines",
  "10316": "Hardlines",
  "10318": "Hardlines",
  "10321": "Hardlines",
  "10322": "Consumable Food",
  "10323": "Hardlines",
  "10324": "Hardlines",
  "10325": "Consumable Food",
  "10326": "Hardlines",
  "10327": "Consumable HBA",
  "10329": "Hardlines",
  "10330": "Hardlines",
  "10331": "Hardlines",
  "10332": "Furniture",
  "10333": "Hardlines",
  "10334": "Consumable Food",
  "10337": "Hardlines",
  "10338": "Hardlines",
  "10339": "Hardlines",
  "10341": "Seasonal",
  "10343": "Softline - Accessories",
  "10344": "Hardlines",
  "10345": "Hardlines",
  "10346": "Consumable Other",
  "10347": "Consumable Other",
  "10348": "Hardlines",
  "10349": "Hardlines",
  "10350": "Hardlines",
  "10351": "Hardlines",
  "10352": "Hardlines",
  "10353": "Hardlines",
  "10355": "Consumable Other",
  "10356": "Hardlines",
  "10358": "Hardlines",
  "10359": "Hardlines",
  "10360": "Hardlines",
  "10363": "Hardlines",
  "10364": "Hardlines",
  "10365": "Hardlines",
  "10366": "Home",
  "10367": "Hardlines",
  "10369": "Hardlines",
  "10373": "Hardlines",
  "10374": "Hardlines",
  "10375": "Hardlines",
  "10376": "Hardlines",
  "10377": "Seasonal",
  "10378": "Consumable Food",
  "10379": "Seasonal",
  "10380": "Consumable Food",
  "10381": "Seasonal",
  "10382": "Consumable Food",
  "10383": "Seasonal",
  "10384": "Consumable Food",
  "10385": "Softline - Apparel",
  "10386": "Softline - Apparel",
  "10387": "Softline - Apparel",
  "10388": "Consumable HBA",
  "10389": "Consumable Other",
  "10390": "Home",
  "10391": "Consumable Other",
  "10392": "Home",
  "10393": "Hardlines",
  "10394": "Consumable HBA",
  "10395": "Softline - Shoes",
  "10396": "Hardlines",
  "10397": "Consumable HBA",
  "10398": "Consumable HBA",
  "10399": "Consumable Other",
  "10400": "Softline - Accessories",
  "10401": "Softline - Apparel",
  "10402": "Softline - Apparel",
  "10403": "Hardlines",
  "10404": "Hardlines",
  "10405": "Furniture",
  "10406": "Softline - Shoes",
  "10407": "Hardlines",
  "10408": "Hardlines",
  "10409": "Furniture",
  "10410": "Hardlines",
  "10412": "Hardlines",
  "10413": "Hardlines",
  "10414": "Hardlines",
  "10415": "Hardlines",
  "10416": "Hardlines",
  "10417": "Hardlines",
  "10418": "Consumable Food",
  "10419": "Consumable Other",
  "10420": "Consumable Other",
  "10421": "Hardlines",
  "10422": "Hardlines",
  "10423": "Hardlines",
  "10426": "Hardlines",
  "10427": "Hardlines",
  "10428": "Hardlines",
  "10429": "Hardlines",
  "10430": "Consumable Food",
  "10431": "Hardlines",
  "10432": "Softline - Shoes",
  "10433": "Hardlines",
  "10435": "Hardlines",
  "10436": "Hardlines",
  "10437": "Hardlines",
  "10438": "Softline - Accessories",
  "10439": "Softline - Apparel",
  "10440": "Hardlines",
  "10441": "Hardlines",
  "10442": "Softline - Shoes",
  "10443": "Softline - Accessories",
  "10444": "Softline - Apparel",
  "10445": "Seasonal",
  "10446": "Hardlines",
  "10447": "Hardlines",
  "10448": "Consumable Food",
  "10449": "Softline - Shoes",
  "10450": "Softline - Apparel",
  "10451": "Consumable Food",
  "10509": "Hardlines",
  "10551": "Hardlines",
  "10618": "Softline - Shoes",
  "10632": "Softline - Shoes",
  "10660": "Softline - Shoes",
  "10771": "Hardlines",
  "10774": "Softline - Shoes",
  "10809": "Softline - Shoes",
  "10822": "Softline - Shoes",
  "11001": "Hardlines",
  "11098": "Hardlines",
  "11099": "Hardlines",
  "11210": "Hardlines",
  "11260": "Softline - Accessories",
  "11327": "Softline - Apparel",
  "11358": "Softline - Shoes",
  "11399": "Softline - Shoes",
  "11516": "Hardlines",
  "11533": "Softline - Shoes",
  "11555": "Hardlines",
  "11566": "Hardlines",
  "11612": "Softline - Apparel",
  "11634": "Softline - Apparel",
  "11652": "Hardlines",
  "11829": "Softline - Shoes",
  "11880": "Softline - Shoes",
  "11881": "Softline - Shoes",
  "11883": "Softline - Apparel",
  "11921": "Hardlines",
  "11973": "Softline - Shoes",
  "12004": "Hardlines",
  "12013": "Hardlines",
  "12152": "Softline - Accessories",
  "12153": "Softline - Apparel",
  "12154": "Softline - Accessories",
  "12429": "Seasonal",
  "12530": "Hardlines",
  "12690": "Seasonal",
  "12726": "Hardlines",
  "12815": "Hardlines",
  "12831": "Softline - Shoes",
  "12841": "Softline - Shoes",
  "12846": "Hardlines",
  "12935": "Hardlines",
  "12936": "Hardlines",
  "12954": "Hardlines",
  "13102": "Softline - Shoes",
  "13134": "Softline - Shoes",
  "13135": "Softline - Apparel",
  "13136": "Hardlines",
  "13144": "Softline - Apparel",
  "13145": "Softline - Accessories",
  "13146": "Softline - Shoes",
  "13147": "Hardlines",
  "13148": "Softline - Shoes",
  "13149": "Hardlines",
  "13206": "Hardlines",
  "13208": "Softline - Shoes",
  "13210": "Hardlines",
  "13211": "Hardlines",
  "13272": "Softline - Shoes",
  "13273": "Hardlines",
  "13275": "Hardlines",
  "13287": "Softline - Shoes",
  "13288": "Softline - Shoes",
  "13293": "Softline - Shoes",
  "13295": "Softline - Accessories",
  "13296": "Hardlines",
  "13302": "Softline - Shoes",
  "13303": "Softline - Apparel",
  "13304": "Softline - Accessories",
  "13338": "Softline - Shoes",
  "13342": "Softline - Shoes",
  "13349": "Softline - Shoes",
  "13355": "Softline - Accessories",
  "13379": "Softline - Shoes",
  "13381": "Hardlines",
  "13384": "Hardlines",
  "13392": "Softline - Apparel",
  "13400": "Softline - Shoes",
  "13401": "Softline - Shoes",
  "13407": "Hardlines",
  "13408": "Hardlines",
  "13412": "Hardlines",
  "13428": "Softline - Shoes",
  "13438": "Softline - Shoes",
  "13442": "Softline - Shoes",
  "13444": "Hardlines",
  "13450": "Softline - Shoes",
  "13469": "Softline - Shoes",
  "13475": "Softline - Apparel",
  "13488": "Hardlines",
  "13492": "Softline - Shoes",
  "13498": "Hardlines",
  "13500": "Hardlines",
  "13502": "Softline - Shoes",
  "13503": "Hardlines",
  "13506": "Softline - Shoes",
  "13507": "Hardlines",
  "13508": "Softline - Shoes",
  "13509": "Hardlines",
  "13510": "Softline - Accessories",
  "13516": "Softline - Shoes",
  "13528": "Softline - Apparel",
  "13547": "Softline - Shoes",
  "13553": "Softline - Shoes",
  "13555": "Softline - Shoes",
  "13557": "Hardlines",
  "13575": "Softline - Shoes",
  "13576": "Softline - Shoes",
  "13580": "Softline - Shoes",
  "13581": "Hardlines",
  "13586": "Softline - Shoes",
  "14005": "Softline - Apparel",
  "14008": "Hardlines",
  "14009": "Softline - Shoes",
  "14010": "Hardlines",
  "14012": "Softline - Apparel",
  "14013": "Hardlines",
  "14014": "Softline - Accessories",
  "14021": "Softline - Shoes",
  "14032": "Softline - Shoes",
  "14034": "Hardlines",
  "14036": "Softline - Apparel",
  "14037": "Hardlines",
  "14043": "Softline - Shoes",
  "14045": "Softline - Accessories",
  "14048": "Softline - Accessories",
  "14049": "Softline - Apparel",
  "14060": "Hardlines",
  "14061": "Hardlines",
  "14062": "Softline - Shoes",
  "14063": "Hardlines",
  "14065": "Hardlines",
  "14066": "Hardlines",
  "14069": "Softline - Shoes",
  "14070": "Hardlines",
  "14071": "Hardlines",
  "14072": "Hardlines",
  "14074": "Hardlines",
  "14075": "Hardlines",
  "14076": "Hardlines",
  "14077": "Hardlines",
  "14080": "Hardlines",
  "14083": "Hardlines",
  "14087": "Hardlines",
  "14088": "Hardlines",
  "14091": "Hardlines",
  "14092": "Hardlines",
  "14093": "Hardlines",
  "14094": "Softline - Apparel",
  "14095": "Softline - Apparel",
  "14102": "Hardlines",
  "14103": "Softline - Shoes",
  "14104": "Softline - Shoes",
  "14105": "Softline - Shoes",
  "14106": "Hardlines",
  "14107": "Hardlines",
  "14108": "Hardlines",
  "14109": "Hardlines",
  "14110": "Home",
  "14111": "Home",
  "14112": "Home",
  "14113": "Softline - Shoes",
  "14114": "Softline - Apparel",
  "14115": "Hardlines",
  "14116": "Furniture",
  "14117": "Hardlines",
  "14118": "Hardlines",
  "14119": "Softline - Apparel",
  "14120": "Hardlines",
  "14121": "Hardlines",
  "14122": "Hardlines",
  "14123": "Hardlines",
  "14124": "Hardlines",
  "14125": "Consumable HBA",
  "14127": "Softline - Apparel",
  "14128": "Softline - Shoes",
  "14129": "Hardlines",
  "14130": "Hardlines",
  "14131": "Hardlines",
  "14132": "Hardlines",
  "14133": "Softline - Shoes",
  "14134": "Hardlines",
  "14135": "Hardlines",
  "14136": "Home",
  "14137": "Hardlines",
  "14138": "Consumable Food",
  "14139": "Consumable Other",
  "14140": "Consumable Other",
  "14141": "Hardlines",
  "14142": "Hardlines",
  "14143": "Hardlines",
  "14144": "Hardlines",
  "14145": "Hardlines",
  "14146": "Hardlines",
  "14147": "Hardlines",
  "14148": "Hardlines",
  "14149": "Hardlines",
  "14150": "Hardlines",
  "14151": "Hardlines",
  "14152": "Seasonal",
  "14153": "Consumable HBA",
  "14154": "Hardlines",
  "14155": "Home",
  "14156": "Softline - Accessories",
  "14157": "Consumable Other",
  "14158": "Consumable HBA",
  "14159": "Consumable HBA",
  "14160": "Hardlines",
  "14161": "Hardlines",
  "14162": "Hardlines",
  "14163": "Consumable Food",
  "14164": "Consumable Food",
  "14165": "Consumable Food",
  "14166": "Furniture",
  "14167": "Softline - Shoes",
  "14168": "Softline - Accessories",
  "14169": "Softline - Apparel",
  "14170": "Softline - Apparel",
  "14171": "Softline - Accessories",
  "14172": "Softline - Apparel",
  "14173": "Softline - Apparel",
  "14174": "Consumable Other",
  "14175": "Hardlines",
  "14176": "Hardlines",
  "14177": "Hardlines",
  "14178": "Softline - Apparel",
  "14179": "Hardlines",
  "14180": "Hardlines",
  "14181": "Hardlines",
  "14182": "Home",
  "14183": "Hardlines",
  "14184": "Consumable Food",
  "14185": "Consumable Food",
  "14186": "Hardlines",
  "14187": "Hardlines",
  "14188": "Hardlines",
  "14189": "Hardlines",
  "14190": "Hardlines",
  "14191": "Hardlines",
  "14192": "Hardlines",
  "14193": "Hardlines",
  "14194": "Hardlines",
  "14195": "Hardlines",
  "14196": "Hardlines",
  "14197": "Hardlines",
  "14198": "Hardlines",
  "14199": "Hardlines",
  "14200": "Hardlines",
  "14201": "Hardlines",
  "14202": "Hardlines",
  "14203": "Seasonal",
  "14204": "Seasonal",
  "14205": "Seasonal",
  "14206": "Hardlines",
  "14207": "Furniture",
  "14208": "Hardlines",
  "14209": "Hardlines",
  "14210": "Hardlines",
  "14211": "Hardlines",
  "14212": "Hardlines",
  "14213": "Seasonal",
  "14214": "Hardlines",
  "14215": "Hardlines",
  "14216": "Hardlines",
  "14217": "Hardlines",
  "14218": "Hardlines",
  "14219": "Seasonal",
  "14220": "Hardlines",
  "14221": "Hardlines",
  "14222": "Hardlines",
  "14223": "Seasonal",
  "14224": "Hardlines",
  "14225": "Seasonal",
  "14226": "Seasonal",
  "14227": "Seasonal",
  "14228": "Hardlines",
  "14229": "Hardlines",
  "14230": "Seasonal",
  "14231": "Hardlines",
  "14232": "Home",
  "14233": "Hardlines",
  "14234": "Seasonal",
  "14235": "Hardlines",
  "14236": "Hardlines",
  "14237": "Hardlines",
  "14238": "Consumable HBA",
  "14239": "Hardlines",
  "14240": "Hardlines",
  "14241": "Hardlines",
  "14242": "Hardlines",
  "14243": "Seasonal",
  "14244": "Hardlines",
  "14245": "Consumable Food",
  "14246": "Consumable Food",
  "14247": "Softline - Apparel",
  "14248": "Softline - Apparel",
  "14249": "Softline - Shoes",
  "14250": "Softline - Shoes",
  "14251": "Consumable Other",
  "14252": "Consumable Other",
  "14253": "Consumable Other",
  "14254": "Consumable HBA",
  "14255": "Hardlines",
  "14256": "Consumable Other",
  "14257": "Hardlines",
  "14258": "Hardlines",
  "14259": "Hardlines",
  "14260": "Home",
  "14261": "Hardlines",
  "14262": "Home",
  "14263": "Hardlines",
  "14264": "Hardlines",
  "14265": "Hardlines",
  "14266": "Home",
  "14267": "Home",
  "14268": "Hardlines",
  "14269": "Home",
  "14270": "Home",
  "14271": "Home",
  "14272": "Home",
  "14273": "Home",
  "14274": "Home",
  "14275": "Furniture",
  "14276": "Furniture",
  "14277": "Softline - Shoes",
  "14278": "Hardlines",
  "14279": "Seasonal",
  "14280": "Consumable Other",
  "14281": "Hardlines",
  "14282": "Consumable Food",
  "14283": "Consumable Food",
  "14284": "Softline - Shoes",
  "14285": "Hardlines",
  "14286": "Hardlines",
  "14287": "Seasonal",
  "14288": "Seasonal",
  "14289": "Seasonal",
  "14290": "Seasonal",
  "14291": "Hardlines",
  "14292": "Hardlines",
  "14293": "Hardlines",
  "14294": "Hardlines",
  "14295": "Hardlines",
  "2000": "Hardlines",
  "2001": "Hardlines",
  "2002": "Hardlines",
  "2003": "Hardlines",
  "2004": "Hardlines",
  "2005": "Hardlines",
  "2020": "Hardlines",
  "2021": "Hardlines",
  "2022": "Hardlines",
  "2023": "Hardlines",
  "2024": "Hardlines",
  "2025": "Hardlines",
  "2026": "Hardlines",
  "2027": "Hardlines",
  "2100": "Hardlines",
  "2101": "Hardlines",
  "2102": "Hardlines",
  "2103": "Hardlines",
  "2104": "Hardlines",
  "2105": "Hardlines",
  "2120": "Hardlines",
  "2121": "Hardlines",
  "2122": "Hardlines",
  "2123": "Hardlines",
  "2124": "Hardlines",
  "2125": "Hardlines",
  "2126": "Hardlines",
  "2127": "Hardlines",
  "30101": "Consumable HBA",
  "30102": "Hardlines",
  "30103": "Hardlines",
  "30104": "Consumable HBA",
  "30105": "Consumable Other",
  "30106": "Hardlines",
  "30107": "Consumable Other",
  "30108": "Softline - Apparel",
  "30109": "Softline - Shoes",
  "30110": "Hardlines",
  "30113": "Hardlines",
  "30114": "Softline - Shoes",
  "30115": "Hardlines",
  "30116": "Seasonal",
  "30117": "Softline - Apparel",
  "30118": "Softline - Apparel",
  "30119": "Hardlines",
  "30120": "Hardlines",
  "30121": "Home",
  "30122": "Home",
  "30123": "Home",
  "30124": "Seasonal",
  "30125": "Consumable Food",
  "30126": "Seasonal",
  "30127": "Consumable Food",
  "30128": "Seasonal",
  "30129": "Consumable Food",
  "30130": "Seasonal",
  "30131": "Seasonal",
  "30132": "Seasonal",
  "30134": "Consumable Food",
  "30135": "Consumable HBA",
  "30136": "Hardlines",
  "30137": "Softline - Apparel",
  "30138": "Hardlines",
  "30139": "Hardlines",
  "30140": "Hardlines",
  "30143": "Hardlines",
  "30144": "Hardlines",
  "30145": "Hardlines",
  "30148": "Hardlines",
  "30201": "Hardlines",
  "30302": "Consumable Food",
  "30303": "Hardlines",
  "30307": "Hardlines",
  "30310": "Seasonal",
  "30314": "Hardlines",
  "30315": "Hardlines",
  "30316": "Seasonal",
  "30317": "Seasonal",
  "30318": "Seasonal",
  "30319": "Softline - Apparel",
  "30320": "Softline - Apparel",
  "30321": "Softline - Apparel",
  "30322": "Consumable HBA",
  "30323": "Consumable Other",
  "30324": "Home",
  "30325": "Consumable Other",
  "30326": "Home",
  "30327": "Hardlines",
  "30328": "Consumable Food",
  "30329": "Consumable HBA",
  "30330": "Seasonal",
  "30331": "Hardlines",
  "30332": "Hardlines",
  "30333": "Consumable HBA",
  "30334": "Consumable Other",
  "30335": "Home",
  "30336": "Consumable Food",
  "30337": "Seasonal",
  "30368": "Hardlines",
  "30500": "Hardlines",
  "30501": "Hardlines",
  "30502": "Hardlines",
  "30503": "Hardlines",
  "30504": "Hardlines",
  "30505": "Hardlines",
  "30506": "Hardlines",
  "30507": "Consumable Food",
  "30508": "Softline - Shoes",
  "30509": "Hardlines",
  "30510": "Softline - Shoes",
  "30511": "Hardlines",
  "30512": "Softline - Apparel",
  "30513": "Consumable Other",
  "30514": "Softline - Accessories",
  "30515": "Consumable Other",
  "30518": "Consumable Other",
  "30519": "Hardlines",
  "30520": "Consumable Food",
  "30521": "Hardlines",
  "30522": "Consumable Other",
  "30523": "Hardlines",
  "30524": "Hardlines",
  "30525": "Seasonal",
  "30526": "Consumable Food",
  "30527": "Seasonal",
  "30528": "Seasonal",
  "30529": "Hardlines",
  "30530": "Consumable Food",
  "30531": "Home",
  "30532": "Hardlines",
  "30533": "Home",
  "30534": "Softline - Shoes",
  "50001": "Hardlines",
  "50002": "Consumable Food",
  "50003": "Consumable Food",
  "50004": "Consumable Food",
  "50005": "Consumable Food",
  "50006": "Consumable Food",
  "50007": "Consumable Food",
  "50008": "Softline - Apparel",
  "50009": "Hardlines",
  "50010": "Consumable HBA",
  "50011": "Hardlines",
  "50012": "Furniture",
  "50013": "Softline - Apparel",
  "50014": "Softline - Shoes",
  "50015": "Home",
  "50016": "Hardlines",
  "50017": "Seasonal",
  "50018": "Furniture",
  "50019": "Hardlines",
  "50020": "Hardlines",
  "50021": "Hardlines",
  "50022": "Hardlines",
  "50023": "Consumable Food",
  "50024": "Consumable HBA",
  "50025": "Consumable HBA",
  "50026": "Consumable Food",
  "50027": "Consumable HBA",
  "50028": "Consumable HBA",
  "50029": "Consumable HBA",
  "50030": "Consumable HBA",
  "50031": "Consumable HBA",
  "50032": "Consumable HBA",
  "50033": "Consumable Food",
  "50034": "Home",
  "50035": "Furniture",
  "50036": "Hardlines",
  "50037": "Hardlines",
  "50038": "Consumable Food",
  "50039": "Consumable HBA",
  "50040": "Consumable HBA",
  "50041": "Consumable Other",
  "50042": "Hardlines",
  "50043": "Hardlines",
  "50044": "Hardlines",
  "50045": "Consumable Food",
  "50046": "Hardlines",
  "50047": "Hardlines",
  "50048": "Hardlines",
  "50049": "Furniture",
  "50050": "Seasonal",
  "50051": "Softline - Shoes",
  "50052": "Softline - Shoes",
  "50053": "Consumable Other",
  "50054": "Home",
  "50055": "Home",
  "50056": "Home",
  "50057": "Hardlines",
  "50058": "Hardlines",
  "50059": "Furniture",
  "50060": "Furniture",
  "50061": "Furniture",
  "50062": "Seasonal",
  "50063": "Hardlines",
  "50064": "Hardlines",
  "50065": "Hardlines",
  "50066": "Consumable HBA",
  "50067": "Hardlines",
  "50068": "Hardlines",
  "50069": "Hardlines",
  "50070": "Hardlines",
  "50071": "Consumable Food",
  "50072": "Consumable Food",
  "50073": "Hardlines",
  "50074": "Seasonal",
  "50075": "Hardlines",
  "50076": "Hardlines",
  "50077": "Softline - Apparel",
  "50078": "Consumable HBA",
  "50079": "Consumable Food",
  "50080": "Seasonal",
  "50081": "Hardlines",
  "50082": "Hardlines",
  "50083": "Home",
  "50084": "Home",
  "50085": "Hardlines",
  "50086": "Hardlines",
  "50087": "Hardlines",
  "50088": "Consumable Food",
  "50089": "Hardlines",
  "50090": "Hardlines",
  "50091": "Hardlines",
  "50092": "Hardlines",
  "50093": "Hardlines",
  "50094": "Hardlines",
  "50095": "Hardlines",
  "50096": "Hardlines",
  "50097": "Hardlines",
  "50098": "Hardlines",
  "50099": "Softline - Apparel",
  "50100": "Hardlines",
  "50101": "Hardlines",
  "50102": "Home",
  "50103": "Hardlines",
  "50104": "Home",
  "50105": "Hardlines",
  "50106": "Consumable Other",
  "50107": "Home",
  "50108": "Consumable Other",
  "50109": "Consumable Other",
  "50110": "Consumable Other",
  "50111": "Softline - Shoes",
  "50112": "Softline - Shoes",
  "50113": "Softline - Shoes",
  "50114": "Softline - Shoes",
  "50115": "Softline - Shoes",
  "50116": "Softline - Apparel",
  "50117": "Softline - Apparel",
  "50118": "Hardlines",
  "50119": "Softline - Accessories",
  "50120": "Hardlines",
  "50121": "Furniture",
  "50122": "Home",
  "50123": "Home",
  "50124": "Home",
  "50125": "Softline - Accessories",
  "50126": "Hardlines",
  "50127": "Hardlines",
  "50128": "Hardlines",
  "50129": "Hardlines",
  "50130": "Hardlines",
  "50131": "Hardlines",
  "50132": "Hardlines",
  "50133": "Hardlines",
  "50134": "Hardlines",
  "50135": "Hardlines",
  "50136": "Hardlines",
  "50137": "Hardlines",
  "50138": "Hardlines",
  "50139": "Hardlines",
  "50140": "Hardlines",
  "50141": "Hardlines",
  "50142": "Hardlines",
  "50143": "Hardlines",
  "50144": "Hardlines",
  "50145": "Hardlines",
  "50146": "Hardlines",
  "50147": "Hardlines",
  "50148": "Hardlines",
  "50149": "Hardlines",
  "50150": "Hardlines",
  "50151": "Hardlines",
  "50152": "Hardlines",
  "50153": "Furniture",
  "50154": "Hardlines",
  "50155": "Hardlines",
  "50156": "Consumable Food",
  "50157": "Hardlines",
  "50158": "Hardlines",
  "50159": "Consumable Food",
  "50160": "Consumable Food",
  "50161": "Consumable Food",
  "50162": "Hardlines",
  "50163": "Seasonal",
  "50164": "Hardlines",
  "50165": "Softline - Shoes",
  "50166": "Hardlines",
  "50167": "Hardlines",
  "50168": "Hardlines",
  "50169": "Hardlines",
  "50170": "Hardlines",
  "50171": "Consumable Food",
  "50172": "Home",
  "50173": "Hardlines",
  "50174": "Hardlines",
  "50175": "Home",
  "50176": "Seasonal",
  "50177": "Hardlines",
  "50178": "Consumable Food",
  "50179": "Hardlines",
  "50180": "Home",
  "50181": "Hardlines",
  "50182": "Hardlines",
  "50183": "Hardlines",
  "50184": "Hardlines",
  "50185": "Home",
  "50186": "Home",
  "50187": "Home",
  "50188": "Home",
  "50189": "Hardlines",
  "50190": "Hardlines",
  "50191": "Softline - Apparel",
  "50192": "Softline - Apparel",
  "50193": "Softline - Shoes",
  "50194": "Softline - Apparel",
  "50195": "Softline - Apparel",
  "50196": "Softline - Apparel",
  "50197": "Hardlines",
  "50198": "Consumable Food",
  "50199": "Consumable HBA",
  "50200": "Consumable Food",
  "50201": "Hardlines",
  "50202": "Hardlines",
  "50203": "Seasonal",
  "50204": "Furniture",
  "50205": "Softline - Accessories",
  "50206": "Softline - Apparel",
  "50207": "Consumable HBA",
  "50208": "Softline - Apparel",
  "50209": "Seasonal",
  "50210": "Softline - Apparel",
  "50211": "Softline - Apparel",
  "50212": "Softline - Apparel",
  "50213": "Softline - Apparel",
  "50214": "Hardlines",
  "50215": "Hardlines",
  "50216": "Hardlines",
  "50217": "Hardlines",
  "50218": "Hardlines",
  "50219": "Hardlines",
  "50220": "Seasonal",
  "50221": "Hardlines",
  "50222": "Seasonal",
  "50223": "Seasonal",
  "50224": "Consumable Other",
  "50225": "Hardlines",
  "50226": "Hardlines",
  "50227": "Softline - Shoes",
  "50228": "Hardlines",
  "50229": "Consumable Food",
  "50230": "Hardlines",
  "50231": "Consumable Food",
  "50232": "Consumable HBA",
  "50233": "Hardlines",
  "50234": "Hardlines",
  "50235": "Hardlines",
  "50236": "Consumable Food",
  "50237": "Consumable HBA",
  "50238": "Softline - Apparel",
  "50239": "Hardlines",
  "50240": "Hardlines",
  "50241": "Home",
  "50242": "Consumable Other",
  "50243": "Consumable Food",
  "50244": "Consumable Other",
  "50245": "Hardlines",
  "50246": "Hardlines",
  "50247": "Softline - Apparel",
  "50248": "Softline - Apparel",
  "50249": "Softline - Apparel",
  "50250": "Consumable Food",
  "50251": "Furniture",
  "50252": "Furniture",
  "50253": "Hardlines",
  "50254": "Softline - Apparel",
  "50255": "Softline - Apparel",
  "50256": "Softline - Apparel",
  "50257": "Softline - Apparel",
  "50258": "Softline - Apparel",
  "50259": "Consumable Food",
  "50260": "Consumable Food",
  "50261": "Consumable Food",
  "50262": "Softline - Accessories",
  "50263": "Hardlines",
  "50264": "Hardlines",
  "50265": "Home",
  "50266": "Home",
  "50267": "Home",
  "50268": "Home",
  "50269": "Seasonal",
  "50270": "Softline - Apparel",
  "50271": "Hardlines",
  "50272": "Hardlines",
  "50273": "Softline - Accessories",
  "50274": "Softline - Accessories",
  "50275": "Softline - Accessories",
  "50276": "Softline - Accessories",
  "50277": "Softline - Accessories",
  "50278": "Hardlines",
  "50279": "Softline - Shoes",
  "50280": "Softline - Shoes",
  "50281": "Softline - Shoes",
  "50282": "Hardlines",
  "50283": "Softline - Apparel",
  "50284": "Softline - Shoes",
  "50285": "Softline - Apparel",
  "50286": "Softline - Shoes",
  "50287": "Softline - Apparel",
  "50288": "Softline - Accessories",
  "50289": "Softline - Apparel",
  "50290": "Hardlines",
  "50291": "Hardlines",
  "50292": "Hardlines",
  "50293": "Hardlines",
  "50294": "Hardlines",
  "50295": "Hardlines",
  "50296": "Hardlines",
  "50297": "Hardlines",
  "50298": "Hardlines",
  "50299": "Softline - Accessories",
  "50300": "Softline - Shoes",
  "50301": "Softline - Shoes",
  "50302": "Hardlines",
  "50303": "Hardlines",
  "50304": "Consumable Other",
  "50305": "Home",
  "50306": "Home",
  "50307": "Consumable Other",
  "50308": "Hardlines",
  "50309": "Consumable HBA",
  "50310": "Hardlines",
  "50311": "Hardlines",
  "50312": "Home",
  "50313": "Furniture",
  "50314": "Consumable Food",
  "50315": "Furniture",
  "50316": "Furniture",
  "50317": "Furniture",
  "50318": "Furniture",
  "50319": "Furniture",
  "50320": "Furniture",
  "50321": "Furniture",
  "50322": "Hardlines",
  "50323": "Softline - Accessories",
  "50324": "Softline - Apparel",
  "50325": "Hardlines",
  "50326": "Hardlines",
  "50327": "Home",
  "50328": "Hardlines",
  "50329": "Hardlines",
  "50330": "Softline - Accessories",
  "50331": "Consumable Other",
  "50332": "Softline - Accessories",
  "50333": "Softline - Accessories",
  "50334": "Softline - Shoes",
  "50335": "Softline - Shoes",
  "50336": "Softline - Shoes",
  "50337": "Softline - Shoes",
  "50338": "Softline - Shoes",
  "50339": "Softline - Shoes",
  "50340": "Softline - Shoes",
  "50341": "Softline - Shoes",
  "50342": "Softline - Shoes",
  "50343": "Hardlines",
  "50344": "Seasonal",
  "50345": "Hardlines",
  "50346": "Hardlines",
  "50347": "Consumable Food",
  "50348": "Hardlines",
  "50349": "Seasonal",
  "50350": "Hardlines",
  "50351": "Hardlines",
  "50352": "Hardlines",
  "50353": "Hardlines",
  "50354": "Hardlines",
  "50355": "Hardlines",
  "50356": "Hardlines",
  "50357": "Seasonal",
  "50358": "Seasonal",
  "50359": "Seasonal",
  "50360": "Seasonal",
  "50361": "Softline - Shoes",
  "50362": "Softline - Shoes",
  "50363": "Softline - Shoes",
  "50364": "Softline - Shoes",
  "50365": "Softline - Shoes",
  "50366": "Softline - Shoes",
  "50367": "Softline - Shoes",
  "50368": "Hardlines",
  "50369": "Consumable Food",
  "50370": "Hardlines",
  "50371": "Hardlines",
  "50372": "Consumable HBA",
  "50373": "Seasonal",
  "50374": "Furniture",
  "50375": "Home",
  "50376": "Consumable Food",
  "50377": "Softline - Apparel",
  "50378": "Softline - Apparel",
  "50379": "Softline - Apparel",
  "50380": "Softline - Apparel",
  "50381": "Softline - Apparel",
  "50382": "Softline - Apparel",
  "50383": "Softline - Apparel",
  "50384": "Softline - Apparel",
  "50385": "Softline - Apparel",
  "50386": "Softline - Apparel",
  "50387": "Consumable HBA",
  "50388": "Hardlines",
  "50389": "Hardlines",
  "50390": "Softline - Apparel",
  "50391": "Softline - Apparel",
  "50392": "Hardlines",
  "10801": "Consumable HBA",
  "50868": "Hardlines",
};

function isBinItem(name) {
  return BIN_PATTERNS.some(p => p.test(name));
}

// ─── Fetch item → category mapping from Clover inventory (cached 24h) ──
async function fetchItemCategoryMap(store, env) {
  const cacheKey = `item-cats:${store.toLowerCase()}`;

  if (env.SALES_SNAPSHOTS) {
    const cached = await env.SALES_SNAPSHOTS.get(cacheKey, "json");
    if (cached) return cached;
  }

  const merchantId = env[`${store}_MERCHANT_ID`];
  const apiToken = env[`${store}_API_TOKEN`];
  if (!merchantId || !apiToken) return {};

  const map = {};
  let offset = 0;
  const limit = 1000;

  while (true) {
    const url = `https://api.clover.com/v3/merchants/${merchantId}/items?expand=categories&limit=${limit}&offset=${offset}`;
    const resp = await fetch(url, {
      headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
    });
    const data = await resp.json();
    if (!data?.elements?.length) break;

    for (const item of data.elements) {
      const catName = item.categories?.elements?.[0]?.name;
      if (catName && item.id) {
        map[item.id] = catName;
      }
    }
    if (data.elements.length < limit) break;
    offset += limit;
  }

  if (env.SALES_SNAPSHOTS) {
    await env.SALES_SNAPSHOTS.put(cacheKey, JSON.stringify(map), { expirationTtl: 86400 });
  }

  return map;
}

// ─── Fetch raw orders from Clover API ────────────────────────────
async function fetchCloverOrders(store, env, sinceTimestamp) {
  const targetStore = store.toUpperCase();
  const merchantId = env[`${targetStore}_MERCHANT_ID`];
  const apiToken = env[`${targetStore}_API_TOKEN`];

  if (!merchantId || !apiToken) return null;

  const limit = 1000;
  let offset = 0;
  const allElements = [];

  while (true) {
    const cloverUrl = `https://api.clover.com/v3/merchants/${merchantId}/orders`
      + `?filter=createdTime>=${sinceTimestamp}`
      + `&filter=state=locked`
      + `&expand=payments,lineItems`
      + `&limit=${limit}&offset=${offset}`;

    const resp = await fetch(cloverUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
    });

    const data = await resp.json();
    if (!data || !data.elements || data.elements.length === 0) break;

    allElements.push(...data.elements);
    if (data.elements.length < limit) break;
    offset += limit;
  }

  return allElements;
}

// ─── Aggregate raw orders into summary metrics ───────────────────
function aggregateOrders(elements, sinceTimestamp) {
  let totalNet = 0, binNet = 0, retailNet = 0;
  let orderCount = 0, totalItemCount = 0;
  let totalTxnTimeMs = 0, txnTimeCount = 0;

  for (const order of elements) {
    if (order.total == null || order.total === 0) continue;
    if (order.state !== "locked") continue;
    if (order.createdTime < sinceTimestamp) continue;

    const totalCents = order.total;

    let taxCents = 0;
    if (order.payments?.elements) {
      for (const pmt of order.payments.elements) {
        taxCents += (pmt.taxAmount || 0);
      }
    }
    const orderNet = totalCents - taxCents;
    totalNet += orderNet;
    if (orderNet > 0) orderCount++;

    // Transaction time
    if (orderNet > 0 && order.createdTime && order.payments?.elements?.length) {
      let lastPaymentTime = 0;
      for (const pmt of order.payments.elements) {
        if (pmt.createdTime > lastPaymentTime) lastPaymentTime = pmt.createdTime;
      }
      if (lastPaymentTime > order.createdTime) {
        const duration = lastPaymentTime - order.createdTime;
        if (duration < MAX_TXN_DURATION_MS) {
          totalTxnTimeMs += duration;
          txnTimeCount++;
        }
      }
    }

    // Classify line items as bin vs retail
    let binItemTotal = 0, retailItemTotal = 0, orderItemCount = 0;
    if (order.lineItems?.elements) {
      for (const item of order.lineItems.elements) {
        const qty = item.unitQty != null ? item.unitQty / 1000 : 1;
        const price = (item.price || 0) * qty;
        orderItemCount += qty;
        if (isBinItem(item.name || "")) {
          binItemTotal += price;
        } else {
          retailItemTotal += price;
        }
      }
    }
    if (orderNet > 0) totalItemCount += orderItemCount;

    // Distribute net proportionally
    const itemGross = binItemTotal + retailItemTotal;
    if (itemGross > 0) {
      binNet += orderNet * (binItemTotal / itemGross);
      retailNet += orderNet * (retailItemTotal / itemGross);
    } else {
      retailNet += orderNet;
    }
  }

  const avgCart = orderCount > 0 ? (totalNet / orderCount) / 100 : 0;
  const avgItems = orderCount > 0 ? totalItemCount / orderCount : 0;
  const avgTxnSec = txnTimeCount > 0 ? Math.round(totalTxnTimeMs / txnTimeCount / 1000) : null;

  return {
    total: totalNet / 100,
    retail: Math.round(retailNet) / 100,
    bin: Math.round(binNet) / 100,
    avgCart,
    avgItems,
    orderCount,
    avgTxnSec,
  };
}

// ─── Save a snapshot to KV + D1 ─────────────────────────────────
async function saveSnapshot(env, store, dateStr, data) {
  const snapshotTime = new Date().toISOString();

  // Write to KV (existing behavior)
  if (env.SALES_SNAPSHOTS) {
    const key = `sales:${store.toLowerCase()}:${dateStr}`;
    await env.SALES_SNAPSHOTS.put(key, JSON.stringify({ ...data, snapshotTime }));
  }

  // Write to D1
  if (env.DB) {
    try {
      await env.DB.prepare(
        `INSERT INTO daily_sales (store, date, total, retail, bin, order_count, avg_cart, avg_items, avg_txn_sec, snapshot_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(store, date) DO UPDATE SET
           total=excluded.total, retail=excluded.retail, bin=excluded.bin,
           order_count=excluded.order_count, avg_cart=excluded.avg_cart,
           avg_items=excluded.avg_items, avg_txn_sec=excluded.avg_txn_sec,
           snapshot_time=excluded.snapshot_time,
           budget=COALESCE(budget, excluded.budget),
           labor_pct=COALESCE(labor_pct, excluded.labor_pct),
           auction=COALESCE(auction, excluded.auction),
           week=COALESCE(week, excluded.week)`
      ).bind(
        store.toUpperCase(), dateStr,
        data.total ?? null, data.retail ?? null, data.bin ?? null,
        data.orderCount ?? null, data.avgCart ?? null, data.avgItems ?? null,
        data.avgTxnSec != null ? Math.round(data.avgTxnSec) : null, snapshotTime
      ).run();
    } catch (e) {
      console.error(`D1 write failed for ${store} ${dateStr}:`, e.message);
    }
  }
}

// ─── Fetch and aggregate for a store, then snapshot ──────────────
async function fetchAggregateAndSnapshot(store, env, sinceTimestamp, dateStr) {
  const elements = await fetchCloverOrders(store, env, sinceTimestamp);
  if (!elements) return null;

  const data = aggregateOrders(elements, sinceTimestamp);
  await saveSnapshot(env, store, dateStr, data);
  return data;
}

// ─── CORS headers ────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Snapshot-Secret",
};

// ─── Worker export ───────────────────────────────────────────────
export default {
  // ── HTTP request handler ──────────────────────────────────────
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // ── History endpoint: ?history=true&store=BL1&from=2026-03-25&to=2026-04-01
    if (url.searchParams.get("history") === "true") {
      const store = url.searchParams.get("store");
      if (!store) {
        return new Response(JSON.stringify({ error: "Please specify a store" }), {
          status: 400, headers: corsHeaders,
        });
      }

      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (!from || !to) {
        return new Response(JSON.stringify({ error: "Please specify from and to dates (YYYY-MM-DD)" }), {
          status: 400, headers: corsHeaders,
        });
      }

      const results = {};
      const current = new Date(from + "T00:00:00Z");
      const end = new Date(to + "T00:00:00Z");

      while (current <= end) {
        const dateStr = current.toISOString().slice(0, 10);
        const val = await env.SALES_SNAPSHOTS.get(`sales:${store.toLowerCase()}:${dateStr}`, "json");
        if (val) results[dateStr] = val;
        current.setUTCDate(current.getUTCDate() + 1);
      }

      return new Response(JSON.stringify(results), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── D1 History endpoint: ?history_d1=true&store=BL1&from=YYYY-MM-DD&to=YYYY-MM-DD
    if (url.searchParams.get("history_d1") === "true") {
      const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
      if (!env.DB) {
        return new Response(JSON.stringify({ error: "D1 not configured" }), { status: 500, headers: corsJson });
      }
      const store = (url.searchParams.get("store") || "").toUpperCase();
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (!store || !from || !to) {
        return new Response(JSON.stringify({ error: "Missing store, from, or to params" }), { status: 400, headers: corsJson });
      }
      const { results: rows } = await env.DB.prepare(
        "SELECT * FROM daily_sales WHERE store = ? AND date >= ? AND date <= ? ORDER BY date"
      ).bind(store, from, to).all();
      const out = {};
      for (const row of rows) {
        out[row.date] = {
          total: row.total, retail: row.retail, bin: row.bin,
          avgCart: row.avg_cart, avgItems: row.avg_items,
          orderCount: row.order_count, avgTxnSec: row.avg_txn_sec,
          snapshotTime: row.snapshot_time,
          budget: row.budget, laborPct: row.labor_pct,
          auction: row.auction, week: row.week,
        };
      }
      return new Response(JSON.stringify(out), { headers: corsJson });
    }

    // ── Manual snapshot endpoint: ?action=snapshot&store=BL1
    if (url.searchParams.get("action") === "snapshot") {
      const secret = request.headers.get("X-Snapshot-Secret");
      if (!env.SNAPSHOT_SECRET || secret !== env.SNAPSHOT_SECRET) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: corsHeaders,
        });
      }

      const store = url.searchParams.get("store");
      if (!store) {
        return new Response(JSON.stringify({ error: "Please specify a store" }), {
          status: 400, headers: corsHeaders,
        });
      }

      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      // Use midnight UTC as the start time for full-day snapshot
      const startOfDay = new Date(dateStr + "T00:00:00Z").getTime();

      try {
        const data = await fetchAggregateAndSnapshot(store.toUpperCase(), env, startOfDay, dateStr);
        if (!data) {
          return new Response(JSON.stringify({ error: "Store keys not found" }), {
            status: 404, headers: corsHeaders,
          });
        }
        return new Response(JSON.stringify({ ok: true, store, date: dateStr, data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Snapshot failed", detail: err.message }), {
          status: 500, headers: corsHeaders,
        });
      }
    }

    // ── Backfill endpoint: ?action=backfill (imports Sheets + KV → D1)
    if (url.searchParams.get("action") === "backfill") {
      const secret = request.headers.get("X-Snapshot-Secret");
      if (!env.SNAPSHOT_SECRET || secret !== env.SNAPSHOT_SECRET) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!env.DB) {
        return new Response(JSON.stringify({ error: "D1 not configured" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const SHEET_ID = "17byTs8k0CjH5gPOuBncq3RS3rL4PJR0PamdnbkKPss8";
      const STORE_TABS = {
        "BL1/BL6 Coliseum": "BL1", "BL2/BL7 South Bend": "BL2",
        "BL4/BL5 Dupont": "BL4", "BL8/BL9 Holland": "BL8",
        "BL12/BL13 Wyoming": "BL12", "BL14/B15 Battle Creek": "BL14"
      };
      const COL = { WEEK:2, DATE:3, B_TOTAL:8, A_RETAIL:17, A_BINS:18, A_AUCTION:19, A_TOTAL:20, A_LABOR:22 };

      function parseNum(cell) {
        if (!cell || cell.v == null || cell.v === "") return null;
        if (typeof cell.v === "number") return cell.v;
        const cleaned = String(cell.v).replace(/[,$%\s]/g, "");
        const n = parseFloat(cleaned);
        return isNaN(n) ? null : n;
      }

      function parseDate(cell) {
        if (!cell || cell.v == null) return null;
        const dv = cell.v;
        if (typeof dv === "string") {
          const dm = dv.match(/Date\((\d+),(\d+),(\d+)\)/);
          if (dm) return new Date(+dm[1], +dm[2], +dm[3]);
          const d = new Date(dv);
          return isNaN(d.getTime()) ? null : d;
        }
        if (typeof dv === "number") {
          const d = new Date(Math.round((dv - 25569) * 86400000));
          return isNaN(d.getTime()) ? null : d;
        }
        return null;
      }

      // Optional: filter to a single store to avoid subrequest limits
      const filterStore = url.searchParams.get("store")?.toUpperCase();
      const storeEntries = Object.entries(STORE_TABS).filter(([, code]) => !filterStore || code === filterStore);

      const summary = {};
      for (const [tabName, storeCode] of storeEntries) {
        let imported = 0, skipped = 0, errors = 0;
        try {
          // Fetch Google Sheets data via GViz API
          const gvizUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?headers=0&sheet=${encodeURIComponent(tabName)}&tqx=out:json`;
          const resp = await fetch(gvizUrl);
          const text = await resp.text();
          // Strip JSONP wrapper: google.visualization.Query.setResponse({...})
          const jsonStart = text.indexOf("{");
          const jsonEnd = text.lastIndexOf("}");
          if (jsonStart === -1 || jsonEnd === -1) { summary[storeCode] = { error: "Failed to parse GViz response" }; continue; }
          const gviz = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
          if (gviz.status !== "ok") { summary[storeCode] = { error: "Sheet returned error" }; continue; }

          const rows = gviz.table.rows || [];
          for (const row of rows) {
            const c = row.c || [];
            const date = parseDate(c[COL.DATE]);
            if (!date) { skipped++; continue; }

            const dateStr = date.toISOString().slice(0, 10);
            const week = c[COL.WEEK]?.v != null ? String(c[COL.WEEK].v) : null;
            const bTotal = parseNum(c[COL.B_TOTAL]);
            const aRetail = parseNum(c[COL.A_RETAIL]);
            const aBins = parseNum(c[COL.A_BINS]);
            const aAuction = parseNum(c[COL.A_AUCTION]);
            const aTotal = parseNum(c[COL.A_TOTAL]);
            const aLabor = parseNum(c[COL.A_LABOR]);

            // Also read KV snapshot for this date (Clover metrics)
            let kvData = null;
            if (env.SALES_SNAPSHOTS) {
              kvData = await env.SALES_SNAPSHOTS.get(`sales:${storeCode.toLowerCase()}:${dateStr}`, "json");
            }

            try {
              await env.DB.prepare(
                `INSERT INTO daily_sales (store, date, week, budget, total, retail, bin, auction, labor_pct,
                  order_count, avg_cart, avg_items, avg_txn_sec, snapshot_time)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(store, date) DO UPDATE SET
                   week=excluded.week, budget=excluded.budget,
                   total=COALESCE(excluded.total, total),
                   retail=COALESCE(excluded.retail, retail),
                   bin=COALESCE(excluded.bin, bin),
                   auction=COALESCE(excluded.auction, auction),
                   labor_pct=COALESCE(excluded.labor_pct, labor_pct),
                   order_count=COALESCE(excluded.order_count, order_count),
                   avg_cart=COALESCE(excluded.avg_cart, avg_cart),
                   avg_items=COALESCE(excluded.avg_items, avg_items),
                   avg_txn_sec=COALESCE(excluded.avg_txn_sec, avg_txn_sec),
                   snapshot_time=COALESCE(excluded.snapshot_time, snapshot_time)`
              ).bind(
                storeCode, dateStr, week, bTotal,
                kvData?.total || aTotal || null, kvData?.retail || aRetail || null, kvData?.bin || aBins || null,
                aAuction || null, aLabor || null,
                kvData?.orderCount ?? null, kvData?.avgCart ?? null, kvData?.avgItems ?? null,
                kvData?.avgTxnSec != null ? Math.round(kvData.avgTxnSec) : null,
                kvData?.snapshotTime ?? null
              ).run();
              imported++;
            } catch (e) {
              errors++;
              console.error(`Backfill D1 error ${storeCode} ${dateStr}:`, e.message);
            }
          }
          summary[storeCode] = { imported, skipped, errors };
        } catch (e) {
          summary[storeCode] = { error: e.message };
        }
      }
      return new Response(JSON.stringify({ ok: true, summary }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Item sales by L2 category: ?action=items&store=BL1
    if (url.searchParams.get("action") === "items") {
      const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
      const store = (url.searchParams.get("store") || "").toUpperCase();
      if (!store) {
        return new Response(JSON.stringify({ error: "Missing store param" }), { status: 400, headers: corsJson });
      }
      const merchantId = env[`${store}_MERCHANT_ID`];
      const apiToken = env[`${store}_API_TOKEN`];
      if (!merchantId || !apiToken) {
        return new Response(JSON.stringify({ error: "Store keys not found" }), { status: 404, headers: corsJson });
      }

      try {
        const { dateStr: todayStr, startOfDay } = getETToday();

        // Fetch orders with lineItems expanded to include item references
        const allElements = [];
        let offset = 0;
        const limit = 1000;
        while (true) {
          const cloverUrl = `https://api.clover.com/v3/merchants/${merchantId}/orders`
            + `?filter=createdTime>=${startOfDay}`
            + `&filter=state=locked`
            + `&expand=payments,lineItems.item,lineItems.discounts`
            + `&limit=${limit}&offset=${offset}`;
          const resp = await fetch(cloverUrl, {
            headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
          });
          const data = await resp.json();
          if (!data?.elements?.length) break;
          allElements.push(...data.elements);
          if (data.elements.length < limit) break;
          offset += limit;
        }

        // Fetch item→category mapping (cached 24h)
        const itemCatMap = await fetchItemCategoryMap(store, env);

        // Aggregate by L2 category
        const cats = {};
        const unmappedL3 = {};  // Track L3 names not in our mapping
        const noCategory = {};  // Track items with no Clover category
        function getCat(name) {
          if (!cats[name]) cats[name] = { qty: 0, gross: 0, discounts: 0, refunds: 0, net: 0 };
          return cats[name];
        }

        for (const order of allElements) {
          if (order.total == null || order.total === 0) continue;

          // Calculate tax for this order
          let taxCents = 0;
          if (order.payments?.elements) {
            for (const pmt of order.payments.elements) {
              taxCents += (pmt.taxAmount || 0);
            }
          }

          const lineItems = order.lineItems?.elements || [];

          for (const li of lineItems) {
            const qty = li.unitQty != null ? li.unitQty / 1000 : 1;
            const priceCents = (li.price || 0) * qty;

            // Determine L3 category from item reference → category map
            let l3 = null;
            const itemId = li.item?.id;
            if (itemId && itemCatMap[itemId]) {
              l3 = itemCatMap[itemId];
            }

            // Map L3 → L2
            let l2;
            if (l3 === "Sku Book Items") {
              // Sku Book items need name-based lookup for correct L2
              l2 = SKU_BOOK_TO_L2[li.name] || "Hardlines";
            } else if (l3 && L3_TO_L2[l3]) {
              l2 = L3_TO_L2[l3];
            } else if (l3) {
              unmappedL3[l3] = (unmappedL3[l3] || 0) + 1;
              l2 = "Uncategorized";
            } else if (li.name === "Refund" || priceCents < 0) {
              l2 = "Refund";
            } else {
              // No Clover category — try matching item name against L3 mapping
              // Normalize em-dashes to hyphens for matching
              const normalized = (li.name || "").replace(/\u2013|\u2014/g, "-");
              const nameMatch = L3_TO_L2[normalized] || L3_TO_L2[li.name];
              if (nameMatch) {
                l2 = nameMatch;
              } else {
                // Try extracting BL number from item name (e.g. "BL10015", "BL-10015", "BL 10015")
                const blMatch = (li.name || "").match(/BL[-\s]*(\d{4,5})/i);
                if (blMatch && IM_TO_L2[blMatch[1]]) {
                  l2 = IM_TO_L2[blMatch[1]];
                } else {
                  // Keyword-based fallback for items without BL numbers
                  const n = (li.name || "").toUpperCase();
                  if (/FURNITURE|DRESSER|SOFA|COUCH|TABLE|CHAIR|DESK|BOOKCASE|SHELV/i.test(n)) {
                    l2 = "Furniture";
                  } else if (/BEDDING|PILLOW|CURTAIN|TOWEL|RUG|DECOR|LAMP|FRAME|VASE|CANDLE/i.test(n)) {
                    l2 = "Home";
                  } else if (/SHOE|BOOT|SANDAL|SLIPPER|SNEAKER/i.test(n)) {
                    l2 = "Softline - Shoes";
                  } else if (/APPAREL|SHIRT|PANT|DRESS|JACKET|COAT|BLOUSE|SWEATER/i.test(n)) {
                    l2 = "Softline - Apparel";
                  } else {
                    const itemName = li.name || "unknown";
                    noCategory[itemName] = (noCategory[itemName] || 0) + 1;
                    l2 = "Custom Sales";
                  }
                }
              }
            }

            const cat = getCat(l2);
            const grossCents = Math.abs(priceCents);

            // Sum discounts on this line item
            let discCents = 0;
            if (li.discounts?.elements) {
              for (const d of li.discounts.elements) {
                discCents += Math.abs(d.amount || 0);
              }
            }

            if (priceCents < 0) {
              // Refund line item
              cat.refunds -= grossCents / 100;
              cat.net -= grossCents / 100;
            } else {
              cat.qty += qty;
              cat.gross += grossCents / 100;
              cat.discounts -= discCents / 100;
              cat.net += (grossCents - discCents) / 100;
            }
          }
        }

        // Calculate totals and format response
        let totalQty = 0, totalGross = 0, totalDisc = 0, totalRef = 0, totalNet = 0;
        const categories = [];
        for (const [name, c] of Object.entries(cats)) {
          totalQty += c.qty;
          totalGross += c.gross;
          totalDisc += c.discounts;
          totalRef += c.refunds;
          totalNet += c.net;
          categories.push({
            category: name,
            qty: Math.round(c.qty),
            gross: Math.round(c.gross * 100) / 100,
            discounts: Math.round(c.discounts * 100) / 100,
            refunds: Math.round(c.refunds * 100) / 100,
            netSales: Math.round(c.net * 100) / 100,
            asp: c.qty > 0 ? Math.round((c.net / c.qty) * 100) / 100 : 0,
          });
        }

        // Sort by net sales descending
        categories.sort((a, b) => b.netSales - a.netSales);

        // Add pctQty
        for (const c of categories) {
          c.pctQty = totalQty > 0 ? Math.round((c.qty / totalQty) * 1000) / 10 : 0;
        }

        return new Response(JSON.stringify({
          store, date: todayStr,
          categories,
          totals: {
            qty: Math.round(totalQty),
            gross: Math.round(totalGross * 100) / 100,
            discounts: Math.round(totalDisc * 100) / 100,
            refunds: Math.round(totalRef * 100) / 100,
            netSales: Math.round(totalNet * 100) / 100,
            asp: totalQty > 0 ? Math.round((totalNet / totalQty) * 100) / 100 : 0,
          },
          orderCount: allElements.length,
          _debug: { unmappedL3, noCategory, itemCatMapSize: Object.keys(itemCatMap).length },
        }), { headers: corsJson });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Items fetch failed", detail: err.message }), {
          status: 500, headers: corsJson,
        });
      }
    }

    // ── Live data endpoint (existing): ?store=BL1&since=timestamp
    const storeKey = url.searchParams.get("store");
    if (!storeKey) {
      return new Response(JSON.stringify({ error: "Please specify a store" }), {
        status: 400, headers: corsHeaders,
      });
    }

    const targetStore = storeKey.toUpperCase();
    const merchantId = env[`${targetStore}_MERCHANT_ID`];
    const apiToken = env[`${targetStore}_API_TOKEN`];

    if (!merchantId || !apiToken) {
      return new Response(JSON.stringify({ error: "Store keys not found in Cloudflare" }), {
        status: 404, headers: corsHeaders,
      });
    }

    const since = url.searchParams.get("since");
    const et = getETToday();
    const startOfToday = since ? Number(since) : et.startOfDay;

    try {
      const elements = await fetchCloverOrders(targetStore, env, startOfToday);
      const result = JSON.stringify({ elements: elements || [] });
      const response = new Response(result, {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

      // Snapshot-on-fetch: save today's aggregated data to KV in background
      if (env.SALES_SNAPSHOTS && elements && elements.length > 0) {
        const aggregated = aggregateOrders(elements, startOfToday);
        ctx.waitUntil(saveSnapshot(env, targetStore, et.dateStr, aggregated));
      }

      return response;
    } catch (error) {
      return new Response(JSON.stringify({ error: "Failed to connect to Clover" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },

  // ── Cron trigger handler (end-of-day snapshots) ───────────────
  async scheduled(event, env, ctx) {
    const { dateStr: todayStr, startOfDay } = getETToday();

    const results = {};

    for (const store of ALL_STORES) {
      try {
        const data = await fetchAggregateAndSnapshot(store, env, startOfDay, todayStr);
        results[store] = data ? "ok" : "skipped (no credentials)";
      } catch (err) {
        results[store] = `error: ${err.message}`;
      }
    }

    console.log("Daily snapshot results:", JSON.stringify(results));
  },
};
