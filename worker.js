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

// Get the Unix-ms timestamp for midnight ET on an arbitrary YYYY-MM-DD string
function getStartOfDayET(dateStr) {
  const noon = new Date(dateStr + 'T16:00:00Z'); // guaranteed to be "that date" in ET
  const tzParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' }).formatToParts(noon);
  const isDST = tzParts.find(p => p.type === 'timeZoneName')?.value === 'EDT';
  const utcOffsetHours = isDST ? 4 : 5;
  return new Date(dateStr + 'T00:00:00Z').getTime() + (utcOffsetHours * 3600000);
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
  "Chemicals": "Consumable Other",
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
  "Accesories": "Softline - Accessories",
  "Hamilton Beach": "Hardlines",
  "FG BL SOFTLINES - APPAREL": "Softline - Apparel",
  "FG BL SOFTLINES - SHOES": "Softline - Shoes",
  "Custom Sales": "Custom Sales",
  "MI Bottle/Can Deposit": "Custom Sales",
  "Refund": "Refund",
  // Additional Clover categories not in original Sheets mapping
  "BL Shoe Event": "Softline - Shoes",
  "Apparel": "Softline - Apparel",
  "Bin Products": "Bin Products",
  "Gift Cards": "Gift Cards",
  "Gift Card": "Gift Cards",
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
  "$1 Food - 50001": "Consumable Food",
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
  "14393": "Hardlines",
  "50868": "Hardlines",
};

function isBinItem(name) {
  return BIN_PATTERNS.some(p => p.test(name));
}

// ─── Clover API fetch helper: retries up to 3x on 429 ───────────────────
async function cloverFetch(url, options) {
  let delay = 1000;
  for (let attempt = 0; attempt <= 3; attempt++) {
    const resp = await fetch(url, options);
    if (resp.status !== 429 || attempt === 3) return resp;
    const retryAfter = parseInt(resp.headers.get("Retry-After") || "0", 10);
    await new Promise(r => setTimeout(r, retryAfter ? retryAfter * 1000 : delay));
    delay *= 2;
  }
}

// ─── Resolve or create a Clover category by name (case-insensitive) ──────
async function resolveCloverCategory(s, categoryName, env) {
  const mId = env[`${s}_MERCHANT_ID`];
  const tok = env[`${s}_API_TOKEN`];
  const headers = { "Authorization": `Bearer ${tok}`, "Content-Type": "application/json" };
  const listResp = await cloverFetch(`https://api.clover.com/v3/merchants/${mId}/categories?limit=1000`, { headers });
  if (!listResp.ok) throw new Error(`categories list: ${listResp.status}`);
  const listData = await listResp.json();
  const existing = (listData.elements || []).find(
    c => (c.name || "").trim().toLowerCase() === categoryName.trim().toLowerCase()
  );
  if (existing) return { categoryId: existing.id, created: false };
  const createResp = await cloverFetch(`https://api.clover.com/v3/merchants/${mId}/categories`, {
    method: "POST", headers, body: JSON.stringify({ name: categoryName }),
  });
  if (!createResp.ok) throw new Error(`category create: ${createResp.status}`);
  const cat = await createResp.json();
  return { categoryId: cat.id, created: true };
}

// ─── Sale Scheduler helpers ─────────────────────────────────────────────
// Read a single Clover item's current price (cents) and name.
async function getCloverItem(env, store, itemId) {
  const mId = env[`${store}_MERCHANT_ID`];
  const tok = env[`${store}_API_TOKEN`];
  const r = await cloverFetch(
    `https://api.clover.com/v3/merchants/${mId}/items/${itemId}`,
    { headers: { Authorization: `Bearer ${tok}` } }
  );
  if (!r.ok) throw new Error(`Clover GET item ${itemId} ${r.status}`);
  const j = await r.json();
  return { price: j.price || 0, name: j.name || "" };
}
// Convenience wrapper — returns only the price (cents).
async function getCloverItemPrice(env, store, itemId) {
  return (await getCloverItem(env, store, itemId)).price;
}

// Write arbitrary fields to a Clover item. Uses POST per Clover convention.
async function setCloverItemFields(env, store, itemId, fields) {
  const mId = env[`${store}_MERCHANT_ID`];
  const tok = env[`${store}_API_TOKEN`];
  const r = await cloverFetch(
    `https://api.clover.com/v3/merchants/${mId}/items/${itemId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tok}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(fields),
    }
  );
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Clover POST item ${itemId} ${r.status} ${txt.slice(0, 200)}`);
  }
  return r;
}
// Convenience wrapper — sets only the price (cents).
async function setCloverItemPrice(env, store, itemId, priceCents) {
  return setCloverItemFields(env, store, itemId, { price: priceCents });
}

const SALE_PREFIX = "SALE ";
const SALE_SUFFIX_RE = / \(was \$[\d,.]+\)$/;

// Build a POS-visible sale name: "SALE Widget (was $12.99 Flash Sale)"
// Clover caps item names at 127 chars; truncate the original name if needed.
function buildSaleName(originalName, originalPriceCents, saleLabel) {
  const price = `$${(originalPriceCents / 100).toFixed(2)}`;
  const suffix = saleLabel ? ` (was ${price} ${saleLabel})` : ` (was ${price})`;
  const maxNameLen = 127 - SALE_PREFIX.length - suffix.length;
  const truncName = originalName.length > maxNameLen
    ? originalName.slice(0, maxNameLen - 1) + "\u2026"
    : originalName;
  return SALE_PREFIX + truncName + suffix;
}

// Compute the target sale price given a discount kind + value.
// Clamps to a 1-cent floor so we never accidentally zero out an item.
function computeSalePrice(originalCents, kind, value) {
  if (kind === "percent") {
    return Math.max(1, Math.round(originalCents * (1 - value / 100)));
  }
  // 'amount' — value is cents off
  return Math.max(1, originalCents - Math.round(value));
}

// Every-minute cron worker: flip prices at starts_at, revert at ends_at.
// Per-tick cap keeps us under CPU budget; next tick drains any backlog.
async function processSaleSchedules(env, now) {
  const nowIso = now.toISOString();
  const PER_TICK = 50;
  const result = { activated: 0, reverted: 0, errors: [] };
  if (!env.DB) return result;

  // 1. Activate pending schedules whose start time has arrived.
  const pending = await env.DB
    .prepare(
      "SELECT * FROM sale_schedules WHERE status='pending' AND starts_at <= ? ORDER BY starts_at ASC LIMIT ?"
    )
    .bind(nowIso, PER_TICK)
    .all();
  await Promise.allSettled((pending.results || []).map(async row => {
    try {
      const item = await getCloverItem(env, row.store, row.item_id);
      const currentCents = item.price;
      const saleCents = computeSalePrice(currentCents, row.discount_kind, row.discount_value);
      if (saleCents >= currentCents) {
        throw new Error(`Computed sale price ${saleCents} >= current ${currentCents}; aborting`);
      }
      const saleName = buildSaleName(item.name, currentCents, row.sale_label);
      await setCloverItemFields(env, row.store, row.item_id, { price: saleCents, name: saleName });
      await env.DB
        .prepare(
          "UPDATE sale_schedules SET original_price=?, sale_price=?, original_name=?, status='active', activated_at=? WHERE id=?"
        )
        .bind(currentCents, saleCents, item.name, nowIso, row.id)
        .run();
      result.activated++;
    } catch (err) {
      result.errors.push(`activate ${row.store}/${row.item_id}: ${err.message}`);
      await env.DB
        .prepare("UPDATE sale_schedules SET status='error', error_msg=? WHERE id=?")
        .bind(String(err.message).slice(0, 500), row.id)
        .run()
        .catch(() => {});
    }
  }));

  // 2. Revert active schedules whose end time has arrived.
  const active = await env.DB
    .prepare(
      "SELECT * FROM sale_schedules WHERE status='active' AND ends_at <= ? ORDER BY ends_at ASC LIMIT ?"
    )
    .bind(nowIso, PER_TICK)
    .all();
  await Promise.allSettled((active.results || []).map(async row => {
    try {
      // Drift guard — don't overwrite if someone manually edited the price
      // while the sale was running. Flag for admin review instead.
      const item = await getCloverItem(env, row.store, row.item_id);
      if (item.price !== row.sale_price) {
        throw new Error(`Price drifted: expected ${row.sale_price}, found ${item.price}. Manual review needed.`);
      }
      const revertFields = { price: row.original_price };
      if (row.original_name) revertFields.name = row.original_name;
      await setCloverItemFields(env, row.store, row.item_id, revertFields);
      await env.DB
        .prepare(
          "UPDATE sale_schedules SET status='completed', reverted_at=? WHERE id=?"
        )
        .bind(nowIso, row.id)
        .run();
      result.reverted++;
    } catch (err) {
      result.errors.push(`revert ${row.store}/${row.item_id}: ${err.message}`);
      await env.DB
        .prepare("UPDATE sale_schedules SET status='error', error_msg=? WHERE id=?")
        .bind(String(err.message).slice(0, 500), row.id)
        .run()
        .catch(() => {});
    }
  }));

  return result;
}

// ─── Fetch item → category mapping from Clover inventory (cached 24h) ──
async function fetchItemCategoryMap(store, env) {
  const cacheKey = `item-cats:${store.toLowerCase()}`;

  if (env.SALES_SNAPSHOTS) {
    const cached = await env.SALES_SNAPSHOTS.get(cacheKey, "json");
    // Don't trust an empty cached map — it was likely written before items
    // were categorized in Clover, or from a transient empty Clover response.
    // Refetch instead so L3-based category resolution can actually work.
    if (cached && Object.keys(cached).length > 0) return cached;
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

// ─── Fetch total refunds (in cents) from Clover for a window ─────
// Clover's Sales Summary computes Net Sales = Gross − Discounts − Refunds.
// Our `order.total` already nets discounts, but refunds are tracked
// separately on /v3/refunds and are NOT consistently subtracted from
// `order.total`. Phase 2A: fetch this endpoint per (store, day) and
// subtract from `totalNet` so dashboard matches Clover Sales Summary.
//
// Phase 2A refinement: subtract `refund.taxAmount` from each refund's
// gross amount. The /v3/refunds endpoint returns refund.amount INCLUDING
// the original tax, but Clover's Sales Summary "Refunds" line is the
// pre-tax portion (mirroring how Net Sales itself is pre-tax). Without
// this, we over-deduct by the refund tax amount.
//
// Defensive: returns 0 on any failure (rate limit, network) — better to
// over-report a single day than to break the snapshot pipeline.
// Fetches raw /v3/refunds elements for a window — used by aggregateItemSales
// to attribute refunds back to the originating line-item categories. Returns
// [] on failure (consistent with fetchRefundsTotal returning 0).
async function fetchRefundElements(store, env, sinceTimestamp, untilTimestamp = null) {
  const merchantId = env[`${store}_MERCHANT_ID`];
  const apiToken = env[`${store}_API_TOKEN`];
  if (!merchantId || !apiToken) return [];
  const all = [];
  let offset = 0;
  const limit = 1000;
  const headers = { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" };
  try {
    while (true) {
      // Phase 2E: /v3/refunds does NOT return lineItem refs even when expanded
      // (confirmed via debug-refunds endpoint — lineItemKeys is []). It DOES
      // return orderRef.id and payment.order.id, so refund attribution uses
      // order-ID lookup against the line-item map built during the main loop.
      let url = `https://api.clover.com/v3/merchants/${merchantId}/refunds`
        + `?filter=createdTime>=${sinceTimestamp}`
        + `&expand=payment,orderRef`
        + `&limit=${limit}&offset=${offset}`;
      if (untilTimestamp) url += `&filter=createdTime<${untilTimestamp}`;
      const data = await cloverFetchWithRetry(url, headers, `Clover refunds(items) ${store}`);
      if (!data?.elements?.length) break;
      all.push(...data.elements);
      if (data.elements.length < limit) break;
      offset += limit;
    }
  } catch (e) {
    console.warn(`fetchRefundElements(${store}) error:`, e.message);
    return [];
  }
  return all;
}

// ─── Fetch "manual refunds" from Clover ─────────────────────────
// "Manual Refunds" in Clover's UI = "Credits" in the API. They're
// manager-initiated card-back transactions. The /v3/credits endpoint
// returns them with the same structure as refunds: { id, amount,
// taxAmount, orderRef, voided, result, ... }. Confirmed via debug
// probe — /v3/manual_refunds is 405 GET-not-allowed, while
// /v3/credits/{id} returns the record matching the UI screenshot.
async function fetchManualRefunds(store, env, sinceTimestamp, untilTimestamp = null) {
  const merchantId = env[`${store}_MERCHANT_ID`];
  const apiToken = env[`${store}_API_TOKEN`];
  if (!merchantId || !apiToken) return [];
  const all = [];
  let offset = 0;
  const limit = 1000;
  const headers = { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" };
  try {
    while (true) {
      let url = `https://api.clover.com/v3/merchants/${merchantId}/credits`
        + `?filter=createdTime>=${sinceTimestamp}`
        + `&limit=${limit}&offset=${offset}`;
      if (untilTimestamp) url += `&filter=createdTime<${untilTimestamp}`;
      const data = await cloverFetchWithRetry(url, headers, `Clover credits ${store}`);
      if (!data?.elements?.length) break;
      // Filter: SUCCESS result only, and skip voided ones.
      for (const r of data.elements) {
        if (r.voided) continue;
        if (r.result && r.result !== "SUCCESS") continue;
        all.push(r);
      }
      if (data.elements.length < limit) break;
      offset += limit;
    }
  } catch (e) {
    console.warn(`fetchManualRefunds(${store}) error:`, e.message);
    return [];
  }
  return all;
}

// sameDayOrders: the locked-order elements already fetched for this day window.
// When provided, same-day refunds (where Clover has already zeroed or reduced
// order.total before the snapshot runs) are detected and skipped to avoid
// double-deducting. Cross-day refunds (original order in a prior snapshot)
// are still deducted normally.
//
// Detection strategy:
//   Full refund  → order.total === 0 AND payment sum ≈ refund.amount
//   Partial refund → order has an order-level refund attached (delta between
//                    payment sum and order.total equals the refund amount)
async function fetchRefundsTotal(store, env, sinceTimestamp, untilTimestamp = null, sameDayOrders = null) {
  const merchantId = env[`${store}_MERCHANT_ID`];
  const apiToken = env[`${store}_API_TOKEN`];
  if (!merchantId || !apiToken) return 0;

  // Build a multiset of pre-tax refund amounts that are already reflected in
  // this day's order.total values, so we don't subtract them a second time.
  // Key: pre-tax cents amount. Value: count of how many times it appears
  // (handles the rare case of two refunds with the same dollar amount).
  const alreadyReflected = new Map(); // preTaxCents → remaining skip count
  if (sameDayOrders) {
    for (const order of sameDayOrders) {
      const pmtSum = (order.payments?.elements || [])
        .reduce((s, p) => s + (p.amount || 0), 0);
      const pmtTax = (order.payments?.elements || [])
        .reduce((s, p) => s + (p.taxAmount || 0), 0);

      if (order.total === 0 && pmtSum > 0) {
        // Full same-day refund: Clover zeroed order.total; the original sale
        // gross (pre-tax) equals pmtSum - pmtTax.
        const preTax = pmtSum - pmtTax;
        if (preTax > 0) alreadyReflected.set(preTax, (alreadyReflected.get(preTax) || 0) + 1);
      } else if (order.total > 0 && pmtSum > order.total) {
        // Partial same-day refund: customer paid more than order.total,
        // difference is the refunded amount (pre-tax, no tax on partial).
        const delta = pmtSum - order.total;
        if (delta > 0) alreadyReflected.set(delta, (alreadyReflected.get(delta) || 0) + 1);
      }
    }
  }

  let total = 0;
  let skipped = 0;
  let offset = 0;
  const limit = 1000;
  const headers = { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" };
  try {
    while (true) {
      let url = `https://api.clover.com/v3/merchants/${merchantId}/refunds`
        + `?filter=createdTime>=${sinceTimestamp}`
        + `&limit=${limit}&offset=${offset}`;
      if (untilTimestamp) url += `&filter=createdTime<${untilTimestamp}`;
      const data = await cloverFetchWithRetry(url, headers, `Clover refunds ${store}`);
      if (!data?.elements?.length) break;
      for (const r of data.elements) {
        // refund.amount includes tax; subtract tax to match Clover's pre-tax "Refunds" line.
        const gross = r.amount || 0;
        const tax = r.taxAmount || 0;
        const preTax = gross - tax;

        // Skip if this amount is already reflected in a same-day order.total.
        if (alreadyReflected.has(preTax) && alreadyReflected.get(preTax) > 0) {
          alreadyReflected.set(preTax, alreadyReflected.get(preTax) - 1);
          skipped += preTax;
          continue;
        }
        total += preTax;
      }
      if (data.elements.length < limit) break;
      offset += limit;
    }
  } catch (e) {
    // Refunds endpoint failure is non-fatal: returning 0 means we just
    // don't subtract refunds for this snapshot (matches pre-Phase-2A
    // behavior). The defensive D1 guard still prevents accidental zeroing.
    console.warn(`fetchRefundsTotal(${store}) error:`, e.message);
    return 0;
  }
  if (skipped > 0) {
    console.log(`fetchRefundsTotal(${store}): skipped ${skipped/100} same-day refunds (already in order.total), deducting ${total/100}`);
  }

  // Phase 2H: also subtract Manual Refunds (a separate Clover concept,
  // not in /v3/refunds — manager-initiated cash/card-back transactions
  // not linked to a specific order). Without this, totals over-report
  // by the manual-refund total.
  try {
    const mrElements = await fetchManualRefunds(store, env, sinceTimestamp, untilTimestamp);
    let manualTotalCents = 0;
    for (const mr of mrElements) {
      const gross = mr.amount || 0;
      const tax = mr.taxAmount || 0;
      manualTotalCents += (gross - tax);
    }
    if (manualTotalCents > 0) {
      console.log(`fetchRefundsTotal(${store}): adding manual refunds ${manualTotalCents/100}`);
      total += manualTotalCents;
    }
  } catch (e) {
    console.warn(`fetchRefundsTotal(${store}) manual_refunds error:`, e.message);
  }

  return total;
}

// ─── Helper: fetch with retry on 429 / 5xx, throw on persistent failure
// Returns the parsed JSON body. Honors Retry-After header where present.
// Critical for Clover endpoints — silently treating a 429 as "no data"
// caused zeroing of real revenue in daily_sales.
async function cloverFetchWithRetry(url, headers, label) {
  const maxAttempts = 5;
  const baseDelayMs = 1000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch(url, { method: "GET", headers });
    if (resp.ok) return await resp.json();

    // 429 (rate limited) and 5xx are retryable; 4xx other than 429 is not.
    const retryable = resp.status === 429 || resp.status >= 500;
    if (!retryable || attempt === maxAttempts) {
      throw new Error(`${label} HTTP ${resp.status} (attempt ${attempt})`);
    }
    const retryAfter = parseInt(resp.headers.get("Retry-After") || "0", 10);
    const sleepMs = retryAfter > 0
      ? Math.min(retryAfter * 1000, 15000)
      : baseDelayMs * Math.pow(2, attempt - 1); // 1s, 2s, 4s, 8s
    await new Promise(r => setTimeout(r, sleepMs));
  }
  throw new Error(`${label} retry loop exited unexpectedly`);
}

// ─── Fetch raw orders from Clover API ────────────────────────────
async function fetchCloverOrders(store, env, sinceTimestamp, untilTimestamp = null) {
  const targetStore = store.toUpperCase();
  const merchantId = env[`${targetStore}_MERCHANT_ID`];
  const apiToken = env[`${targetStore}_API_TOKEN`];

  if (!merchantId || !apiToken) return null;

  const limit = 1000;
  let offset = 0;
  const allElements = [];
  const headers = {
    "Authorization": `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };

  while (true) {
    let cloverUrl = `https://api.clover.com/v3/merchants/${merchantId}/orders`
      + `?filter=createdTime>=${sinceTimestamp}`
      + `&filter=state=locked`
      + `&expand=payments,lineItems`
      + `&limit=${limit}&offset=${offset}`;
    if (untilTimestamp) cloverUrl += `&filter=createdTime<${untilTimestamp}`;

    // Retries on 429/5xx with exponential backoff. Throws on persistent
    // failure — caller (fetchAggregateAndSnapshot) will not write a
    // snapshot, and the defensive D1 guard prevents accidental zeroing.
    const data = await cloverFetchWithRetry(cloverUrl, headers, `Clover orders ${targetStore}`);
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
  let orderCount = 0, totalItemCount = 0, retailItemCount = 0;
  let retailOnlyItemCount = 0, retailOrderCount = 0; // avg items: retail orders only
  let totalTxnTimeMs = 0, txnTimeCount = 0;
  let cartNet = 0, cartCount = 0; // avg cart excludes bin-only orders

  for (const order of elements) {
    if (order.total == null || order.total === 0) continue;
    if (order.state !== "locked") continue;
    if (order.createdTime < sinceTimestamp) continue;

    // Phase 2G: same fix as aggregateItemSales — use payment.amount instead
    // of order.total for the gross figure. For same-day refunded orders,
    // Clover reduces order.total by the refund amount but leaves
    // payment.amount at its original value. Using payment.amount gives us
    // the ORIGINAL pre-refund net, and the refund subtraction step
    // (applyRefundsToAggregate) handles deducting the refund. Without
    // this, same-day refunded orders contribute too little to total.
    let taxCents = 0;
    let pmtSumCents = 0;
    if (order.payments?.elements) {
      for (const pmt of order.payments.elements) {
        taxCents += (pmt.taxAmount || 0);
        pmtSumCents += (pmt.amount || 0);
      }
    }
    const totalCents = pmtSumCents > 0 ? pmtSumCents : order.total;
    const orderNet = totalCents - taxCents;

    // Classify line items as bin vs retail vs gift card.
    // Gift card purchases are excluded from net revenue (they are deferred
    // revenue / liabilities) — matching Clover's own Sales Summary behaviour.
    // Gift card amounts are subtracted before accumulating any totals.
    let binItemTotal = 0, retailItemTotal = 0, giftCardTotal = 0, orderItemCount = 0, retailQty = 0;
    if (order.lineItems?.elements) {
      for (const item of order.lineItems.elements) {
        const qty = item.unitQty != null ? item.unitQty / 1000 : 1;
        const price = (item.price || 0) * qty;
        orderItemCount += qty;
        if (/\bGIFT\s*CARD\b/i.test(item.name || "")) {
          giftCardTotal += price;
        } else if (isBinItem(item.name || "")) {
          binItemTotal += price;
        } else {
          retailItemTotal += price;
          retailQty += qty;
        }
      }
    }

    // Adjusted order net: strip out gift card face value (not taxed, not earned revenue)
    const adjustedOrderNet = orderNet - giftCardTotal;
    if (adjustedOrderNet <= 0) continue; // pure gift-card order — skip entirely

    totalNet += adjustedOrderNet;
    orderCount++;
    // ASP denominator must be the actual retail item count, not "1 per
    // order that had retail items" (that made ASP ≈ avgCart). retailQty
    // already accumulates per-line-item qty above.
    if (orderNet > 0) retailItemCount += retailQty;
    totalItemCount += orderItemCount;

    // Transaction time
    if (order.createdTime && order.payments?.elements?.length) {
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

    // Distribute adjusted net proportionally across bin / retail
    const itemGross = binItemTotal + retailItemTotal; // excludes gift cards
    if (itemGross > 0) {
      binNet    += adjustedOrderNet * (binItemTotal    / itemGross);
      retailNet += adjustedOrderNet * (retailItemTotal / itemGross);
    } else {
      retailNet += adjustedOrderNet;
    }

    // Avg cart + avg items: retail portion only; exclude bin-only and gift-card-only orders
    if (itemGross === 0) {
      // No categorisable line items (manual entry) — treat as retail
      cartNet += adjustedOrderNet;
      cartCount++;
      retailOnlyItemCount += orderItemCount;
      retailOrderCount++;
    } else if (retailItemTotal > 0) {
      cartNet += adjustedOrderNet * (retailItemTotal / itemGross);
      cartCount++;
      retailOnlyItemCount += retailQty;
      retailOrderCount++;
    }
    // Pure bin orders (retailItemTotal === 0) are excluded from avg cart and avg items
  }

  const avgCart = cartCount > 0 ? (cartNet / cartCount) / 100 : 0;
  const avgItems = retailOrderCount > 0 ? retailOnlyItemCount / retailOrderCount : 0;
  const avgTxnSec = txnTimeCount > 0 ? Math.round(totalTxnTimeMs / txnTimeCount / 1000) : null;
  const avgASP = retailItemCount > 0 ? retailNet / retailItemCount / 100 : null;

  return {
    total: totalNet / 100,
    retail: Math.round(retailNet) / 100,
    bin: Math.round(binNet) / 100,
    avgCart,
    avgItems,
    orderCount,
    avgTxnSec,
    avgASP,
  };
}

// ─── Save item sales snapshot to KV ─────────────────────────────
async function saveItemSalesSnapshot(env, store, dateStr, itemData) {
  if (env.SALES_SNAPSHOTS) {
    const key = `items:${store.toLowerCase()}:${dateStr}`;
    await env.SALES_SNAPSHOTS.put(key, JSON.stringify({
      ...itemData,
      snapshotTime: new Date().toISOString()
    }));
  }
}

// ─── Weekly retail helpers ──────────────────────────────────────

// Resolve a (year, week) pair → 7 ISO date strings (Mon–Sun). Best-effort
// fallback when D1 has no rows for the week yet (e.g. the sheet hasn't been
// imported). D1 is the source of truth otherwise — see resolveWeekDates().
function getISOWeekDates(year, week) {
  // ISO 8601: week 1 contains Jan 4. Monday is day-of-week 1.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7; // Sun=7
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1));
  const start = new Date(week1Monday);
  start.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// Resolve a sheet-derived `week` label to its 7 dates. Trusts D1 since the
// `week` column is whatever the Google Sheet says, not strictly ISO. Falls
// back to ISO calc only when D1 has no rows for that (week, year) yet.
async function resolveWeekDates(env, week, year) {
  if (env.DB) {
    try {
      // D1 weeks are stored across all stores; DISTINCT date for the week
      // covers the same dates regardless of store. Filter by year via the
      // `date LIKE 'YYYY-%'` prefix so cross-year duplicate week numbers
      // don't collide.
      const { results } = await env.DB.prepare(
        "SELECT DISTINCT date FROM daily_sales WHERE week = ? AND date LIKE ? ORDER BY date"
      ).bind(String(week), `${year}-%`).all();
      if (results && results.length) return results.map(r => r.date);
    } catch (e) {
      console.error("resolveWeekDates D1 error:", e.message);
    }
  }
  const w = parseInt(week, 10);
  const y = parseInt(year, 10);
  if (Number.isFinite(w) && Number.isFinite(y)) return getISOWeekDates(y, w);
  return [];
}

// Merge an array of per-day item-sales snapshots into a single weekly object
// with the same { categories, totals } shape, including nested l3Rows.
// Tolerant of legacy snapshots that lack `l3Rows` or cost — those days just
// contribute zero cost and emit no L3 detail.
function mergeItemSnapshots(snapshots) {
  const cats = {}; // L2 → { qty, gross, discounts, refunds, net, cost, l3: { l3Name → {qty,gross,discounts,refunds,net,cost} } }
  let totalOrders = 0;
  for (const snap of snapshots) {
    if (!snap || !Array.isArray(snap.categories)) continue;
    totalOrders += Number(snap.orderCount) || 0;
    for (const c of snap.categories) {
      const name = c.category || "Uncategorized";
      if (!cats[name]) {
        cats[name] = { qty: 0, gross: 0, discounts: 0, refunds: 0, net: 0, cost: 0, covItem: 0, covCat: 0, covNone: 0, l3: {} };
      }
      const bucket = cats[name];
      bucket.qty += Number(c.qty) || 0;
      bucket.gross += Number(c.gross) || 0;
      bucket.discounts += Number(c.discounts) || 0;
      bucket.refunds += Number(c.refunds) || 0;
      bucket.net += Number(c.netSales) || 0;
      bucket.cost += Number(c.cost) || 0;
      // Coverage is optional on legacy snapshots; missing → contributes 0 (shows
      // as "unknown" in the report rather than falsely counting as uncovered).
      const cov = c.coverage || {};
      bucket.covItem += Number(cov.item) || 0;
      bucket.covCat += Number(cov.category) || 0;
      bucket.covNone += Number(cov.none) || 0;
      if (Array.isArray(c.l3Rows)) {
        for (const l of c.l3Rows) {
          const lName = l.l3 || "(uncategorized)";
          if (!bucket.l3[lName]) {
            bucket.l3[lName] = { qty: 0, gross: 0, discounts: 0, refunds: 0, net: 0, cost: 0, covItem: 0, covCat: 0, covNone: 0 };
          }
          const lb = bucket.l3[lName];
          lb.qty += Number(l.qty) || 0;
          lb.gross += Number(l.gross) || 0;
          lb.discounts += Number(l.discounts) || 0;
          lb.refunds += Number(l.refunds) || 0;
          lb.net += Number(l.netSales) || 0;
          lb.cost += Number(l.cost) || 0;
          const lcov = l.coverage || {};
          lb.covItem += Number(lcov.item) || 0;
          lb.covCat += Number(lcov.category) || 0;
          lb.covNone += Number(lcov.none) || 0;
        }
      }
    }
  }
  let totalQty = 0, totalGross = 0, totalDisc = 0, totalRef = 0, totalNet = 0, totalCost = 0;
  let totCovItem = 0, totCovCat = 0, totCovNone = 0;
  const categories = [];
  for (const [name, c] of Object.entries(cats)) {
    totalQty += c.qty; totalGross += c.gross; totalDisc += c.discounts;
    totalRef += c.refunds; totalNet += c.net; totalCost += c.cost;
    totCovItem += c.covItem; totCovCat += c.covCat; totCovNone += c.covNone;
    const gp = c.net - c.cost;
    const l3Rows = Object.entries(c.l3).map(([l3Name, lc]) => {
      const lgp = lc.net - lc.cost;
      return {
        l3: l3Name,
        qty: Math.round(lc.qty),
        gross: roundCents(lc.gross),
        discounts: roundCents(lc.discounts),
        refunds: roundCents(lc.refunds),
        netSales: roundCents(lc.net),
        asp: lc.qty > 0 ? roundCents(lc.net / lc.qty) : 0,
        cost: roundCents(lc.cost),
        extCost: roundCents(lc.cost),
        grossProfit: roundCents(lgp),
        gpmPct: lc.net > 0 ? Math.round((lgp / lc.net) * 1000) / 10 : 0,
        coverage: { item: roundCents(lc.covItem), category: roundCents(lc.covCat), none: roundCents(lc.covNone) },
      };
    }).sort((a, b) => b.netSales - a.netSales);
    categories.push({
      category: name,
      qty: Math.round(c.qty),
      gross: roundCents(c.gross),
      discounts: roundCents(c.discounts),
      refunds: roundCents(c.refunds),
      netSales: roundCents(c.net),
      asp: c.qty > 0 ? roundCents(c.net / c.qty) : 0,
      cost: roundCents(c.cost),
      extCost: roundCents(c.cost),
      grossProfit: roundCents(gp),
      gpmPct: c.net > 0 ? Math.round((gp / c.net) * 1000) / 10 : 0,
      coverage: { item: roundCents(c.covItem), category: roundCents(c.covCat), none: roundCents(c.covNone) },
      l3Rows,
    });
  }
  categories.sort((a, b) => b.netSales - a.netSales);
  for (const c of categories) {
    c.pctQty = totalQty > 0 ? Math.round((c.qty / totalQty) * 1000) / 10 : 0;
    for (const l of c.l3Rows || []) {
      l.pctQty = totalQty > 0 ? Math.round((l.qty / totalQty) * 1000) / 10 : 0;
    }
  }
  const totalGp = totalNet - totalCost;
  return {
    categories,
    totals: {
      qty: Math.round(totalQty),
      gross: roundCents(totalGross),
      discounts: roundCents(totalDisc),
      refunds: roundCents(totalRef),
      netSales: roundCents(totalNet),
      asp: totalQty > 0 ? roundCents(totalNet / totalQty) : 0,
      cost: roundCents(totalCost),
      grossProfit: roundCents(totalGp),
      gpmPct: totalNet > 0 ? Math.round((totalGp / totalNet) * 1000) / 10 : 0,
      coverage: { item: roundCents(totCovItem), category: roundCents(totCovCat), none: roundCents(totCovNone) },
    },
    orderCount: totalOrders,
  };
}

// Build a per-store weekly bundle (daily rows + KPI totals + merged item sales)
// for use by both ?action=weekly-summary and the week-summary KV pre-roll.
async function buildStoreWeekly(env, store, dates) {
  const lc = store.toLowerCase();
  // Daily sales rows from D1 (one row per date)
  let dailyRows = [];
  if (env.DB && dates.length) {
    const placeholders = dates.map(() => "?").join(",");
    const { results } = await env.DB.prepare(
      `SELECT date, total, retail, bin, auction, budget, labor_pct, order_count, avg_cart
       FROM daily_sales WHERE store = ? AND date IN (${placeholders}) ORDER BY date`
    ).bind(store, ...dates).all();
    dailyRows = results || [];
  }
  // Item sales snapshots from KV (one per date)
  const itemSnaps = await Promise.all(
    dates.map(d => env.SALES_SNAPSHOTS
      ? env.SALES_SNAPSHOTS.get(`items:${lc}:${d}`, "json")
      : Promise.resolve(null))
  );

  // KPI totals from D1 daily rows. netSales = D1.total + D1.auction
  // ("all revenue"), mirroring the Dashboard's store-card total which now
  // includes manually-entered auction sales. D1.total alone is just POS
  // revenue (aggregateItemSales grand total); auction is a separate manual
  // entry from the Google Sheet that isn't part of any Clover category but
  // IS part of the store's actual daily revenue.
  let netSales = 0, retail = 0, bin = 0, auction = 0, budget = 0, transactions = 0;
  let laborNumerator = 0, laborDenominator = 0;
  for (const r of dailyRows) {
    const rowTotal = Number(r.total) || 0;
    const rowAuction = Number(r.auction) || 0;
    const rowRevenue = rowTotal + rowAuction;
    netSales += rowRevenue;
    retail += Number(r.retail) || 0;
    bin += Number(r.bin) || 0;
    auction += rowAuction;
    budget += Number(r.budget) || 0;
    transactions += Number(r.order_count) || 0;
    const lp = Number(r.labor_pct);
    if (Number.isFinite(lp) && rowRevenue > 0) {
      laborNumerator += lp * rowRevenue;
      laborDenominator += rowRevenue;
    }
  }
  const merged = mergeItemSnapshots(itemSnaps.filter(Boolean));
  // Inject a synthetic "Auction" row into the item-sales categories so the
  // per-store L2 table sums to netSales (auction included). Without this,
  // the L2 Total in the footer wouldn't match the Net Sales tile in the
  // header for any store with auction sales.
  if (auction > 0) {
    merged.categories.push({
      category: "Auction",
      qty: 0,
      gross: roundCents(auction),
      discounts: 0,
      refunds: 0,
      netSales: roundCents(auction),
      asp: 0,
      cost: 0,
      extCost: 0,
      grossProfit: roundCents(auction),
      gpmPct: 100,
      pctQty: 0,
      l3Rows: [],
    });
    merged.categories.sort((a, b) => b.netSales - a.netSales);
    merged.totals.netSales = roundCents(merged.totals.netSales + auction);
    merged.totals.gross = roundCents(merged.totals.gross + auction);
    merged.totals.grossProfit = roundCents((merged.totals.grossProfit || 0) + auction);
  }
  const qty = merged.totals.qty;
  // ASP = per-item average price. Auction sales have no item count (qty=0),
  // so including auction in the numerator would inflate the per-Clover-item
  // ASP. Use POS revenue only here.
  const asp = qty > 0 ? (netSales - auction) / qty : 0;
  const variance = netSales - budget;
  const variancePct = budget > 0 ? (variance / budget) * 100 : 0;
  const laborPct = laborDenominator > 0 ? laborNumerator / laborDenominator : 0;

  return {
    daily: dailyRows.map(r => ({
      date: r.date,
      total: Number(r.total) || 0,
      retail: Number(r.retail) || 0,
      bin: Number(r.bin) || 0,
      auction: Number(r.auction) || 0,
      orderCount: Number(r.order_count) || 0,
      avgCart: Number(r.avg_cart) || 0,
      budget: Number(r.budget) || 0,
      laborPct: Number(r.labor_pct) || 0,
    })),
    totals: {
      netSales: roundCents(netSales),
      retail: roundCents(retail),
      bin: roundCents(bin),
      auction: roundCents(auction),
      qty,
      transactions,
      asp: roundCents(asp),
      budget: roundCents(budget),
      varianceDollar: roundCents(variance),
      variancePct: Math.round(variancePct * 10) / 10,
      laborPct: Math.round(laborPct * 10) / 10,
    },
    itemSales: merged,
    l2Qty: Object.fromEntries(merged.categories.map(c => [c.category, Math.round(c.qty)])),
    l2Net: Object.fromEntries(merged.categories.map(c => [c.category, roundCents(c.netSales)])),
  };
}

// Pre-roll a single (store, week, year) into `week-summary:<store>:<week>-<year>`.
// Cron calls this for every week whose 7 days are now in D1; the rebuild
// endpoint calls it across an entire year for backfill.
async function writeWeekSummary(env, store, week, year) {
  if (!env.SALES_SNAPSHOTS) return null;
  const dates = await resolveWeekDates(env, week, year);
  if (!dates.length) return null;
  const bundle = await buildStoreWeekly(env, store, dates);
  const payload = {
    store, week: String(week), year: Number(year), dates,
    totals: bundle.totals,
    l2Qty: bundle.l2Qty || {},
    l2Net: bundle.l2Net || {},
    snapshotTime: new Date().toISOString(),
  };
  await env.SALES_SNAPSHOTS.put(
    `week-summary:${store.toLowerCase()}:${week}-${year}`,
    JSON.stringify(payload)
  );
  return payload;
}

// Cron-side rollup: when today is Sunday (last day of an ISO-style week), the
// week's 7 days are now finalized — write the pre-roll for every store.
async function rollupWeekSummariesIfReady(env, todayStr) {
  if (!env.DB) return;
  // Look up any week where today is the latest date for that week → that
  // week's 7 days are present in D1. Trust the sheet's week label.
  const { results } = await env.DB.prepare(
    "SELECT DISTINCT week FROM daily_sales WHERE date = ?"
  ).bind(todayStr).all();
  if (!results || !results.length) return;
  const year = parseInt(todayStr.slice(0, 4), 10);
  for (const r of results) {
    const wk = r.week;
    if (!wk) continue;
    for (const store of ALL_STORES) {
      try { await writeWeekSummary(env, store, wk, year); }
      catch (e) { console.error(`writeWeekSummary ${store}/${wk}:`, e.message); }
    }
  }
}

// ─── Admin-managed item categorization overrides ────────────────
// Stored globally (all stores share) in KV key `item-overrides:global` as:
//   {
//     items:   { "id:<cloverItemId>"|"name:<normalized>": "<L2>" },
//     patterns:[{type,value,category}],
//     l3Map:   { "<clover-L3-category-name>": "<L2>" }
//   }
// pattern type ∈ "prefix" | "contains" | "im-number".
// l3Map catches items that DO have a Clover catalog category but that L3 name
// isn't in the built-in L3_TO_L2 map — these otherwise route to "Uncategorized".
const ITEM_OVERRIDES_KEY = "item-overrides:global";
const EMPTY_OVERRIDES = { items: {}, patterns: [], l3Map: {} };
const VALID_L2 = new Set([
  "Softline - Apparel", "Softline - Shoes", "Softline - Accessories",
  "Home", "Furniture", "Hardlines",
  "Consumable Food", "Consumable HBA", "Consumable Other",
  "Seasonal", "Bin Products", "Gift Cards",
  "Sku Book Items", "Custom Sales", "Refund",
]);

// Normalize an item name for lookup: trim, lowercase, collapse whitespace,
// normalize en/em dashes. Matches what we'd write into `overrides.items` as a key.
function normalizeItemName(s) {
  return String(s || "")
    .replace(/\u2013|\u2014/g, "-")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

async function fetchItemOverrides(env) {
  if (!env.SALES_SNAPSHOTS) return EMPTY_OVERRIDES;
  const val = await env.SALES_SNAPSHOTS.get(ITEM_OVERRIDES_KEY, "json");
  if (!val || typeof val !== "object") return EMPTY_OVERRIDES;
  return {
    items: val.items && typeof val.items === "object" ? val.items : {},
    patterns: Array.isArray(val.patterns) ? val.patterns : [],
    l3Map: val.l3Map && typeof val.l3Map === "object" ? val.l3Map : {},
  };
}

// ─── Admin-managed Item Master cost map ─────────────────────────
// Stored globally (all stores share) in KV key `item-costs:global` as:
//   { items: { "<itemNo>": { cost: number, desc: string } }, importedAt, count }
// Populated via the ?action=item-costs admin endpoint. Used by aggregateItemSales
// to enrich line-items with cost so the Weekly Retail Summary page can show CPU,
// Ext Cost, Gross Profit, GPM%.
const ITEM_COSTS_KEY = "item-costs:global";
// Admin-managed flat $/unit cost per L3 Clover category, stored globally in KV
// key `category-costs:global` as { costs: { "<l3 category>": number }, importedAt, count }.
// Populated via ?action=category-costs. Used by aggregateItemSales as the cost
// fallback when a line item has no item-master (IM#) cost — keyed on the full
// Clover L3 category string (e.g. "FG BL SEASONAL - CHRISTMAS - GM").
const CATEGORY_COSTS_KEY = "category-costs:global";
const EMPTY_ITEM_COSTS = { items: {}, categories: {}, importedAt: null, count: 0, categoriesImportedAt: null, categoriesCount: 0 };

// Loads BOTH cost maps in one shot: per-item (IM#) costs and per-L3-category
// flat costs. They ride on the same object so aggregateItemSales — which already
// receives this — gets category costs for free, with no new function parameter.
async function fetchItemCosts(env) {
  if (!env.SALES_SNAPSHOTS) return EMPTY_ITEM_COSTS;
  const [val, catVal] = await Promise.all([
    env.SALES_SNAPSHOTS.get(ITEM_COSTS_KEY, "json"),
    env.SALES_SNAPSHOTS.get(CATEGORY_COSTS_KEY, "json"),
  ]);
  const safe = (val && typeof val === "object") ? val : {};
  const safeCat = (catVal && typeof catVal === "object") ? catVal : {};
  return {
    items: safe.items && typeof safe.items === "object" ? safe.items : {},
    importedAt: safe.importedAt || null,
    count: Number(safe.count) || 0,
    categories: safeCat.costs && typeof safeCat.costs === "object" ? safeCat.costs : {},
    categoriesImportedAt: safeCat.importedAt || null,
    categoriesCount: Number(safeCat.count) || 0,
  };
}

// Match a line item against admin pattern rules. First matching rule wins.
// type=prefix: normalized name startsWith value (case-insensitive, normalized)
// type=contains: normalized name includes value
// type=im-number: the already-extracted 4-5 digit IM number equals value exactly
function matchOverridePattern(rawName, imNum, patterns) {
  if (!patterns || !patterns.length) return null;
  const norm = normalizeItemName(rawName);
  for (const p of patterns) {
    if (!p || !p.type || !p.value || !p.category) continue;
    if (!VALID_L2.has(p.category)) continue;
    const v = String(p.value).trim().toLowerCase();
    if (!v) continue;
    if (p.type === "prefix") {
      if (norm.startsWith(v)) return p.category;
    } else if (p.type === "contains") {
      if (norm.includes(v)) return p.category;
    } else if (p.type === "im-number") {
      if (imNum && String(imNum) === String(p.value).trim()) return p.category;
    }
  }
  return null;
}

// ─── Aggregate orders into L2 item sales categories ─────────────
// `overrides` is the shape returned by fetchItemOverrides(). Safe to pass
// undefined / EMPTY_OVERRIDES — caller threads it in for live + snapshot paths.
// `itemCosts` is the shape returned by fetchItemCosts(); used to enrich each
// line-item with cost so we can emit cost / extCost / grossProfit / gpmPct.
function aggregateItemSales(allElements, itemCatMap, store, dateStr, overrides, itemCosts, refundElements = [], extraOrdersForRefundLookup = [], manualRefundElements = []) {
  const ov = overrides || EMPTY_OVERRIDES;
  const ovItems = ov.items || {};
  const ovPatterns = ov.patterns || [];
  const ic = itemCosts || EMPTY_ITEM_COSTS;
  const icItems = ic.items || {};
  const icCats = ic.categories || {};   // L3 Clover category → flat $/unit cost (fallback)
  const cats = {};        // L2 → { qty, gross, discounts, refunds, net, cost }
  const l3Cats = {};      // L2 → L3 → { qty, gross, discounts, refunds, net, cost }
  const unmappedL3 = {};
  const noCategory = {};
  // Map line-item id → { l2, l3Key } for refund attribution after the main loop.
  // Built during the per-order line-item walk so refunds from /v3/refunds (which
  // reference lineItem.id) can be attributed back to the originating category.
  const lineItemCatMap = new Map();
  // Phase 2E: orderId → [{ l2, l3Key, grossCents }] for order-ID-based refund
  // attribution. Clover's /v3/refunds endpoint doesn't return lineItem refs,
  // so we look refunds up by order ID and distribute them proportionally
  // across that order's line items by gross value.
  const orderLineItemMap = new Map();
  // Per-channel (retail vs bin) per-order rollup for the dashboard channel
  // filter. Bin = L2 "Bin Products"; everything else = retail. Positive lines
  // only (gross of refunds) — drives the channel-filtered matrix tiles, not
  // the books. An order is counted toward a channel if it has ≥1 of its items.
  const _ch = { retail: { net: 0, units: 0, orders: 0 }, bin: { net: 0, units: 0, orders: 0 } };
  // covItem/covCat/covNone = net $ whose cost came from an IM# item-master cost
  // (known), an L3 category flat cost (estimate), or no cost source (uncovered).
  // Feeds the Cost Coverage report so admins can see what's known vs. estimated.
  function getCat(name) {
    if (!cats[name]) cats[name] = { qty: 0, gross: 0, discounts: 0, refunds: 0, net: 0, cost: 0, covItem: 0, covCat: 0, covNone: 0 };
    return cats[name];
  }
  function getL3(l2, l3) {
    if (!l3Cats[l2]) l3Cats[l2] = {};
    if (!l3Cats[l2][l3]) l3Cats[l2][l3] = { qty: 0, gross: 0, discounts: 0, refunds: 0, net: 0, cost: 0, covItem: 0, covCat: 0, covNone: 0 };
    return l3Cats[l2][l3];
  }

  for (const order of allElements) {
    // Skip null / zero / NEGATIVE orders. Negative-total orders are Clover's
    // representation of manual refunds (an "order" with a "Manual Transaction"
    // negative line item). aggregateOrders skips these via adjustedOrderNet<=0
    // and accounts for the refund via /v3/credits in fetchRefundsTotal. If we
    // process them here, the negative line items get dumped into "Refund" L2
    // AND the same dollars get subtracted AGAIN as "Manual Refund" L2 — a
    // double-deduction equal to the manual-refund total per day.
    if (order.total == null || order.total <= 0) continue;
    if (order.state !== "locked") continue;

    // Phase 2G: compute orderNetCents from payment.amount (original, pre-refund)
    // rather than order.total (which Clover reduces by gross refund amounts for
    // same-day refunds). For unrefunded orders payment.amount === order.total so
    // the value is unchanged. For refunded orders this gives us the ORIGINAL
    // pre-tax net that matches the line-item sum — the refund attribution loop
    // below handles deducting refunds per category. Without this, the residual
    // reconciliation dumps the refund-gross into "Other / Non-Item".
    let taxCents = 0;
    let pmtSumCents = 0;
    if (order.payments?.elements) {
      for (const pmt of order.payments.elements) {
        taxCents += (pmt.taxAmount || 0);
        pmtSumCents += (pmt.amount || 0);
      }
    }
    // Use payment sum when available (covers refunded orders); fall back to
    // order.total for orders with no payment data (rare — usually voids).
    const grossOrderCents = pmtSumCents > 0 ? pmtSumCents : order.total;
    const orderNetCents = grossOrderCents - taxCents;

    const lineItems = order.lineItems?.elements || [];
    let orderLineItemNetCents = 0;
    const _ordCh = { retail: { net: 0, units: 0 }, bin: { net: 0, units: 0 } };

    // ── Phase 2B: pre-compute discounts (amount + percentage) ─────
    // Clover stores percentage-based discounts as `percentage` with no
    // `amount` field. The previous code only read `amount`, missing
    // ~70% of discounts ($936/day at BL1). Two-pass approach:
    //   1) For each line item, resolve its line-level disc (amount or
    //      gross × percentage / 100). Track post-line-disc subtotal.
    //   2) Resolve order-level disc against that subtotal.
    //   3) In the main loop below, distribute order-level disc
    //      proportionally to each line item's post-line-disc net.
    let subtotalAfterLineDiscCents = 0;
    const liDiscCache = new Map(); // li -> lineDiscCents
    for (const li of lineItems) {
      const qty = li.unitQty != null ? li.unitQty / 1000 : 1;
      const liGrossCents = Math.abs((li.price || 0) * qty);
      let lineDiscCents = 0;
      for (const d of (li.discounts?.elements || [])) {
        if (d.amount != null && d.amount !== 0) {
          lineDiscCents += Math.abs(d.amount);
        } else if (d.percentage) {
          lineDiscCents += Math.round(liGrossCents * Number(d.percentage) / 100);
        }
      }
      liDiscCache.set(li, lineDiscCents);
      if ((li.price || 0) >= 0) {
        subtotalAfterLineDiscCents += (liGrossCents - lineDiscCents);
      }
    }
    let orderDiscCents = 0;
    for (const d of (order.discounts?.elements || [])) {
      if (d.amount != null && d.amount !== 0) {
        orderDiscCents += Math.abs(d.amount);
      } else if (d.percentage && subtotalAfterLineDiscCents > 0) {
        orderDiscCents += Math.round(subtotalAfterLineDiscCents * Number(d.percentage) / 100);
      }
    }

    for (const li of lineItems) {
      const qty = li.unitQty != null ? li.unitQty / 1000 : 1;
      const priceCents = (li.price || 0) * qty;

      // Hoisted IM-number extraction: needed both for cost lookup (regardless
      // of which categorization tier resolves L2) and for the Tier-6 IM_TO_L2
      // fallback below. Pulled out of the deeply-nested if-ladder so the value
      // is available at line-item scope.
      const blMatchEarly = (li.name || "").match(/BL[-\s]*(\d{4,5})/i);
      const bareMatchEarly = !blMatchEarly && (li.name || "").match(/\b(\d{4,5})\b/);
      const imNum = blMatchEarly?.[1] || bareMatchEarly?.[1];

      // Tier 0: admin-assigned per-item override (id: or name: key). Skips all
      // downstream heuristics so Settings UI edits take effect immediately.
      const itemId = li.item?.id;
      const nameKey = normalizeItemName(li.name);
      let l2 = null;
      let l2Source = null;  // "override" | "clover-l3" | "name" | "im" | "heuristic" | "pattern" | "custom"
      if (itemId && ovItems["id:" + itemId] && VALID_L2.has(ovItems["id:" + itemId])) {
        l2 = ovItems["id:" + itemId];
        l2Source = "override";
      } else if (nameKey && ovItems["name:" + nameKey] && VALID_L2.has(ovItems["name:" + nameKey])) {
        l2 = ovItems["name:" + nameKey];
        l2Source = "override";
      }

      // Determine L3 category from item reference → category map
      let l3 = null;
      // L3 string usable for category-cost lookup even when the item has no
      // Clover catalog category — e.g. name-matched items whose name IS an L3
      // category string. Lets category costs reach those rows too.
      let l3CostKey = null;
      if (!l2 && itemId && itemCatMap[itemId]) {
        l3 = itemCatMap[itemId];
      }

      // Map L3 → L2
      if (l2) {
        // override already decided
      } else if (l3 === "Sku Book Items") {
        l2 = SKU_BOOK_TO_L2[li.name] || "Hardlines";
        l2Source = "clover-l3";
      } else if (l3 && ov.l3Map && ov.l3Map[l3] && VALID_L2.has(ov.l3Map[l3])) {
        // Admin L3 mapping wins over built-in L3_TO_L2 so overrides can also
        // correct mis-categorized Clover categories, not just add new ones.
        l2 = ov.l3Map[l3];
        l2Source = "clover-l3";
      } else if (l3 && L3_TO_L2[l3]) {
        l2 = L3_TO_L2[l3];
        l2Source = "clover-l3";
      } else if (l3) {
        // Enriched tracking: {qty, net} so the Settings UI can rank L3s by
        // revenue impact and admins fix the biggest offenders first.
        const bucket = unmappedL3[l3] || { qty: 0, net: 0 };
        bucket.qty += qty;
        bucket.net += priceCents / 100;
        unmappedL3[l3] = bucket;
        l2 = "Uncategorized";
        l2Source = "clover-l3";
      } else if (li.name === "Refund" || priceCents < 0) {
        l2 = "Refund";
        l2Source = "custom";
      } else {
        const normalized = (li.name || "").replace(/\u2013|\u2014/g, "-");
        const nameMatch = L3_TO_L2[normalized] || L3_TO_L2[li.name];
        if (nameMatch) {
          l2 = nameMatch;
          l2Source = "name";
          // The matched key IS a real L3 category string → use it for cost lookup.
          l3CostKey = L3_TO_L2[normalized] ? normalized : li.name;
        } else {
          if (imNum && IM_TO_L2[imNum]) {
            l2 = IM_TO_L2[imNum];
            l2Source = "im";
          } else {
            const n = (li.name || "").toUpperCase();
            if (/\bGIFT\s*CARD\b/i.test(li.name || "")) {
              l2 = "Gift Cards";
              l2Source = "heuristic";
            } else if (/\bBIN\b|FILL A BAG|GLASS CASE/i.test(li.name || "")) {
              // Matches "Bin", "$3 Bin", "Fill a Bag", etc. — same patterns as
              // the live-tile isBinItem(). Safety net when Clover catalog loses
              // the "Bin Products" category assignment (e.g. after item edit).
              l2 = "Bin Products";
              l2Source = "heuristic";
            } else if (/EASTER|VALENTINE|CHRISTMAS|HALLOWEEN|FOURTH OF JULY|4TH OF JULY|ST[.\s]*PATRICK|HOLIDAY|SEASONAL/i.test(n)) {
              l2 = "Seasonal";
              l2Source = "heuristic";
            } else if (/FURNITURE|DRESSER|SOFA|COUCH|TABLE|CHAIR|DESK|BOOKCASE|SHELV|RECLINER|LOVESEAT|OTTOMAN|MATTRESS/i.test(n)) {
              l2 = "Furniture";
              l2Source = "heuristic";
            } else if (/BEDDING|PILLOW|CURTAIN|TOWEL|RUG|DECOR|LAMP|FRAME|VASE|CANDLE/i.test(n)) {
              l2 = "Home";
              l2Source = "heuristic";
            } else if (/SHOE|BOOT|SANDAL|SLIPPER|SNEAKER/i.test(n)) {
              l2 = "Softline - Shoes";
              l2Source = "heuristic";
            } else if (/APPAREL|SHIRT|PANT|DRESS|JACKET|COAT|BLOUSE|SWEATER/i.test(n)) {
              l2 = "Softline - Apparel";
              l2Source = "heuristic";
            } else if (/CHEMICAL|CLEANING|DETERGENT/i.test(n)) {
              l2 = "Consumable Other";
              l2Source = "heuristic";
            } else if (/MASK|HEMP|OIL|LOTION|CREAM|SOAP|SHAMPOO|BODY|NAIL POLISH|COSMETIC/i.test(n)) {
              l2 = "Consumable HBA";
              l2Source = "heuristic";
            } else if (/FOOD|SNACK|CANDY|BEVERAGE|DRINK/i.test(n)) {
              l2 = "Consumable Food";
              l2Source = "heuristic";
            } else if (/KAYAK|BIKE|GRILL|TOOL|ELECTRONICS|TOY|HAMILTON BEACH|FIRE PIT/i.test(n)) {
              l2 = "Hardlines";
              l2Source = "heuristic";
            } else {
              // Tier 6.5: admin-defined pattern rules (prefix / contains / im-number).
              // First match wins so more specific rules should be written earlier.
              const patternL2 = matchOverridePattern(li.name, imNum, ovPatterns);
              if (patternL2) {
                l2 = patternL2;
                l2Source = "pattern";
              } else {
                const itemName = li.name || "unknown";
                const bucket = noCategory[itemName] || { qty: 0, net: 0, itemId: itemId || null };
                bucket.qty += qty;
                // Record positive net; refund branch above won't reach here.
                bucket.net += priceCents / 100;
                if (!bucket.itemId && itemId) bucket.itemId = itemId;
                noCategory[itemName] = bucket;
                l2 = "Custom Sales";
                l2Source = "custom";
              }
            }
          }
        }
      }

      // ── L3 key resolution ─────────────────────────────────────
      // Goal: keep the L3 row count bounded and deterministic. Real Clover L3
      // names pass through verbatim. Heuristic / IM / pattern hits collapse to
      // a single synthetic row per (L2, source) so the per-store table doesn't
      // explode with thousands of one-off product names. Custom Sales / Refund /
      // Uncategorized keep raw item names so admins can still identify offenders.
      let l3Key;
      if (l2Source === "clover-l3" && l3) {
        l3Key = l3;
      } else if (l2Source === "override") {
        l3Key = "[Override] " + l2;
      } else if (l2Source === "name") {
        l3Key = "[Name match] " + (li.name || "(unnamed)");
      } else if (l2Source === "im") {
        l3Key = "[IM " + (imNum || "?") + "] " + l2;
      } else if (l2Source === "pattern") {
        l3Key = "[Pattern] " + l2;
      } else if (l2Source === "heuristic") {
        l3Key = "[Heuristic] " + l2;
      } else if (l2 === "Custom Sales" || l2 === "Refund" || l2 === "Uncategorized") {
        l3Key = li.name || "(unnamed)";
      } else {
        l3Key = "[Other] " + l2;
      }

      const cat = getCat(l2);
      const l3Cat = getL3(l2, l3Key);
      const grossCents = Math.abs(priceCents);

      // Record this line item's category so refunds from /v3/refunds (which
      // reference lineItem.id) can be attributed back to the right L2/L3.
      if (li.id) lineItemCatMap.set(li.id, { l2, l3Key });

      // Phase 2E: track positive-priced line items per order for refund
      // attribution. Refund rows (priceCents < 0) are skipped — refunds get
      // attributed BY this map, not pushed to it.
      if (order.id && priceCents > 0) {
        let arr = orderLineItemMap.get(order.id);
        if (!arr) { arr = []; orderLineItemMap.set(order.id, arr); }
        arr.push({ l2, l3Key, grossCents: priceCents });
      }

      // Phase 2B: line-level discount (resolved above, handles % case)
      let discCents = liDiscCache.get(li) || 0;

      // Phase 2B: allocate order-level discount proportionally to this
      // line item's contribution to the post-line-discount subtotal.
      // Skip refund rows (priceCents < 0) — they shouldn't carry order-disc share.
      if (priceCents >= 0 && orderDiscCents > 0 && subtotalAfterLineDiscCents > 0) {
        const lineNetCents = grossCents - discCents;
        if (lineNetCents > 0) {
          discCents += Math.round(orderDiscCents * lineNetCents / subtotalAfterLineDiscCents);
        }
      }

      // Cost lookup, in precedence order:
      //   1. IM# item-master cost (join on the number extracted above) — wins.
      //   2. L3 category flat cost — fallback keyed on the real Clover category
      //      string `l3` (NOT l3Key, which may be a bracketed synthetic label).
      //   3. 0 — renders `—` in the CPU/Ext Cost columns.
      const costRecord = imNum ? icItems[imNum] : null;
      let unitCost = 0, costSource = "none";
      const costL3 = l3 || l3CostKey;   // real Clover L3, or name-matched L3 string
      if (costRecord && Number.isFinite(Number(costRecord.cost))) {
        unitCost = Number(costRecord.cost);
        costSource = "item";
      } else if (costL3) {
        const catCost = Number(icCats[costL3]);
        if (Number.isFinite(catCost) && catCost > 0) { unitCost = catCost; costSource = "category"; }
      }

      if (priceCents < 0) {
        cat.refunds -= grossCents / 100;
        cat.net -= grossCents / 100;
        l3Cat.refunds -= grossCents / 100;
        l3Cat.net -= grossCents / 100;
        orderLineItemNetCents -= grossCents;
      } else {
        const lineCost = unitCost * qty;
        cat.qty += qty;
        cat.gross += grossCents / 100;
        cat.discounts -= discCents / 100;
        cat.net += (grossCents - discCents) / 100;
        cat.cost += lineCost;
        l3Cat.qty += qty;
        l3Cat.gross += grossCents / 100;
        l3Cat.discounts -= discCents / 100;
        l3Cat.net += (grossCents - discCents) / 100;
        l3Cat.cost += lineCost;
        const lineNet = (grossCents - discCents) / 100;
        const covKey = costSource === "item" ? "covItem" : costSource === "category" ? "covCat" : "covNone";
        cat[covKey] += lineNet;
        l3Cat[covKey] += lineNet;
        orderLineItemNetCents += (grossCents - discCents);
        const _b = (l2 === 'Bin Products') ? _ordCh.bin : _ordCh.retail;
        _b.net += (grossCents - discCents) / 100;
        _b.units += qty;
      }
    }

    // Reconcile line-item sum to order net (order.total - tax). Any residual
    // — custom-amount sales with no line items, line-item modifications, order
    // service charges — is routed to a clearly labeled bucket so the Grand
    // Total matches the Weekly Breakdown's Sales figure for this day. Round
    // to whole cents first so sub-cent artifacts from weighted-item arithmetic
    // don't create phantom $0.00 rows.
    const residualCents = Math.round(orderNetCents - orderLineItemNetCents);
    if (residualCents !== 0) {
      const cat = getCat("Other / Non-Item");
      cat.net += residualCents / 100;
    }
    for (const k of ['retail', 'bin']) {
      if (_ordCh[k].units > 0) { _ch[k].orders++; _ch[k].net += _ordCh[k].net; _ch[k].units += _ordCh[k].units; }
    }
  }

  // ── Phase 2F: cross-day order line-item lookup ─────────────────────────
  // Populates orderLineItemMap for orders fetched specifically to resolve
  // cross-day refunds (refunds posted today against orders from prior days).
  // These orders are NOT added to revenue/qty/disc totals — they exist only
  // so the refund-attribution loop below can find their line items by ID.
  for (const order of (extraOrdersForRefundLookup || [])) {
    if (!order?.id || order.state !== "locked") continue;
    const lineItems = order.lineItems?.elements || [];
    for (const li of lineItems) {
      const qty = li.unitQty != null ? li.unitQty / 1000 : 1;
      const priceCents = (li.price || 0) * qty;
      if (priceCents <= 0) continue;

      const itemId = li.item?.id;
      const nameKey = normalizeItemName(li.name);
      let l2 = null;

      // Tier 0: admin override (id: or name: key)
      if (itemId && ovItems["id:" + itemId] && VALID_L2.has(ovItems["id:" + itemId])) {
        l2 = ovItems["id:" + itemId];
      } else if (nameKey && ovItems["name:" + nameKey] && VALID_L2.has(ovItems["name:" + nameKey])) {
        l2 = ovItems["name:" + nameKey];
      }

      // Tier 1: Clover L3 → L2
      if (!l2 && itemId && itemCatMap[itemId]) {
        const l3 = itemCatMap[itemId];
        if (l3 === "Sku Book Items") l2 = SKU_BOOK_TO_L2[li.name] || "Hardlines";
        else if (ov.l3Map && ov.l3Map[l3] && VALID_L2.has(ov.l3Map[l3])) l2 = ov.l3Map[l3];
        else if (L3_TO_L2[l3]) l2 = L3_TO_L2[l3];
      }

      // Tier 2: name heuristics (same patterns as main loop)
      if (!l2) {
        const liName = li.name || "";
        const n = liName.toUpperCase();
        if (/\bGIFT\s*CARD\b/i.test(liName)) l2 = "Gift Cards";
        else if (/\bBIN\b|FILL A BAG|GLASS CASE/i.test(liName)) l2 = "Bin Products";
        else if (/EASTER|VALENTINE|CHRISTMAS|HALLOWEEN|FOURTH OF JULY|4TH OF JULY|ST[.\s]*PATRICK|HOLIDAY|SEASONAL/i.test(n)) l2 = "Seasonal";
        else if (/FURNITURE|DRESSER|SOFA|COUCH|TABLE|CHAIR|DESK|BOOKCASE|SHELV|RECLINER|LOVESEAT|OTTOMAN|MATTRESS/i.test(n)) l2 = "Furniture";
        else if (/BEDDING|PILLOW|CURTAIN|TOWEL|RUG|DECOR|LAMP|FRAME|VASE|CANDLE/i.test(n)) l2 = "Home";
        else if (/SHOE|BOOT|SANDAL|SLIPPER|SNEAKER/i.test(n)) l2 = "Softline - Shoes";
        else if (/APPAREL|SHIRT|PANT|DRESS|JACKET|COAT|BLOUSE|SWEATER/i.test(n)) l2 = "Softline - Apparel";
        else if (/CHEMICAL|CLEANING|DETERGENT/i.test(n)) l2 = "Consumable Other";
        else if (/MASK|HEMP|OIL|LOTION|CREAM|SOAP|SHAMPOO|BODY|NAIL POLISH|COSMETIC/i.test(n)) l2 = "Consumable HBA";
        else if (/FOOD|SNACK|CANDY|BEVERAGE|DRINK/i.test(n)) l2 = "Consumable Food";
        else if (/KAYAK|BIKE|GRILL|TOOL|ELECTRONICS|TOY|HAMILTON BEACH|FIRE PIT/i.test(n)) l2 = "Hardlines";
      }

      // Tier 3: admin pattern rules
      if (!l2) {
        const blM = (li.name || "").match(/BL[-\s]*(\d{4,5})/i);
        const bareM = !blM && (li.name || "").match(/\b(\d{4,5})\b/);
        const imNum = blM?.[1] || bareM?.[1];
        const patternL2 = matchOverridePattern(li.name, imNum, ovPatterns);
        if (patternL2) l2 = patternL2;
      }

      // Fallback
      if (!l2) l2 = "Custom Sales";

      const l3Key = "[Cross-day refund source] " + l2;
      let arr = orderLineItemMap.get(order.id);
      if (!arr) { arr = []; orderLineItemMap.set(order.id, arr); }
      arr.push({ l2, l3Key, grossCents: priceCents });
    }
  }

  // ── Process refunds from /v3/refunds endpoint ───────────────────────────
  // Clover's refunds live on a separate endpoint and are NOT subtracted from
  // order.total. Each refund returns orderRef.id (or payment.order.id) but
  // does NOT return lineItem refs — even with expand=lineItem,lineItem.item
  // it returns nothing. Confirmed via debug-refunds endpoint.
  //
  // Strategy: build orderLineItemMap (orderId → [{l2, l3Key, grossCents}])
  // during the main loop above, then for each refund:
  //   1. Look up the original order's line items by orderRef.id.
  //   2. Distribute the refund proportionally across that order's line items
  //      by their gross-value share.
  //   3. If the order isn't in our fetched data (true cross-day refund),
  //      fall back to a generic "Refund" L2 bucket.
  for (const ref of (refundElements || [])) {
    const refGross = ref.amount || 0;
    const refTax   = ref.taxAmount || 0;
    const refNetCents = refGross - refTax;
    if (refNetCents <= 0) continue;

    const orderId = ref.orderRef?.id || ref.payment?.order?.id || null;
    const orderLineItems = orderId ? orderLineItemMap.get(orderId) : null;

    if (orderLineItems && orderLineItems.length > 0) {
      // Distribute the refund proportionally across this order's line items
      // by their gross-value share. Most refunds will be same-day so the
      // original order is in our fetched data and we can do an exact split.
      const totalGrossCents = orderLineItems.reduce((s, li) => s + li.grossCents, 0);
      if (totalGrossCents > 0) {
        let remainingCents = refNetCents;
        for (let i = 0; i < orderLineItems.length; i++) {
          const li = orderLineItems[i];
          const isLast = i === orderLineItems.length - 1;
          // Last line item absorbs any rounding residual so the total
          // refund attribution equals refNetCents exactly.
          const shareCents = isLast
            ? remainingCents
            : Math.round(refNetCents * li.grossCents / totalGrossCents);
          remainingCents -= shareCents;
          const cat   = getCat(li.l2);
          const l3Cat = getL3(li.l2, li.l3Key);
          cat.refunds   -= shareCents / 100;
          cat.net       -= shareCents / 100;
          l3Cat.refunds -= shareCents / 100;
          l3Cat.net     -= shareCents / 100;
        }
      } else {
        // Order has no positive-gross line items (rare — perhaps already
        // fully refunded earlier). Fall through to generic Refund L2.
        const cat   = getCat("Refund");
        const l3Cat = getL3("Refund", "Order has no positive line items");
        cat.refunds   -= refNetCents / 100;
        cat.net       -= refNetCents / 100;
        l3Cat.refunds -= refNetCents / 100;
        l3Cat.net     -= refNetCents / 100;
      }
    } else {
      // True cross-day refund: original order isn't in today's fetched
      // data. Without the order's line items we can't attribute by
      // category — bucket into generic Refund L2.
      const cat   = getCat("Refund");
      const l3Cat = getL3("Refund", "Cross-day refunds");
      cat.refunds   -= refNetCents / 100;
      cat.net       -= refNetCents / 100;
      l3Cat.refunds -= refNetCents / 100;
      l3Cat.net     -= refNetCents / 100;
    }
  }

  // ── Phase 2H: process Manual Refunds (not in /v3/refunds) ──────────────
  // Manual Refunds are manager-initiated cash/card-back transactions that
  // aren't linked to any order — they have no line items, so they can't
  // attribute to a product category. Bucket them into a "Manual Refund" L2
  // row so the Grand Total reconciles with Clover's Sales Summary.
  for (const mr of (manualRefundElements || [])) {
    if (mr.result && mr.result !== "SUCCESS") continue;
    const gross = mr.amount || 0;
    const tax = mr.taxAmount || 0;
    const preTaxCents = gross - tax;
    if (preTaxCents <= 0) continue;
    const cat = getCat("Manual Refund");
    const l3Cat = getL3("Manual Refund", "Manual cash/card-back");
    cat.refunds   -= preTaxCents / 100;
    cat.net       -= preTaxCents / 100;
    l3Cat.refunds -= preTaxCents / 100;
    l3Cat.net     -= preTaxCents / 100;
  }

  // Calculate totals and format response
  let totalQty = 0, totalGross = 0, totalDisc = 0, totalRef = 0, totalNet = 0, totalCost = 0;
  let totCovItem = 0, totCovCat = 0, totCovNone = 0;
  const categories = [];
  for (const [name, c] of Object.entries(cats)) {
    totalQty += c.qty;
    totalGross += c.gross;
    totalDisc += c.discounts;
    totalRef += c.refunds;
    totalNet += c.net;
    totalCost += c.cost;
    totCovItem += c.covItem; totCovCat += c.covCat; totCovNone += c.covNone;
    const grossProfit = c.net - c.cost;
    const l3Map = l3Cats[name] || {};
    const l3Rows = [];
    for (const [l3Name, lc] of Object.entries(l3Map)) {
      const l3Gp = lc.net - lc.cost;
      l3Rows.push({
        l3: l3Name,
        qty: Math.round(lc.qty),
        gross: roundCents(lc.gross),
        discounts: roundCents(lc.discounts),
        refunds: roundCents(lc.refunds),
        netSales: roundCents(lc.net),
        asp: lc.qty > 0 ? roundCents(lc.net / lc.qty) : 0,
        cost: roundCents(lc.cost),
        extCost: roundCents(lc.cost),
        grossProfit: roundCents(l3Gp),
        gpmPct: lc.net > 0 ? Math.round((l3Gp / lc.net) * 1000) / 10 : 0,
        coverage: { item: roundCents(lc.covItem), category: roundCents(lc.covCat), none: roundCents(lc.covNone) },
      });
    }
    l3Rows.sort((a, b) => b.netSales - a.netSales);
    categories.push({
      category: name,
      qty: Math.round(c.qty),
      gross: roundCents(c.gross),
      discounts: roundCents(c.discounts),
      refunds: roundCents(c.refunds),
      netSales: roundCents(c.net),
      asp: c.qty > 0 ? roundCents(c.net / c.qty) : 0,
      cost: roundCents(c.cost),
      extCost: roundCents(c.cost),
      grossProfit: roundCents(grossProfit),
      gpmPct: c.net > 0 ? Math.round((grossProfit / c.net) * 1000) / 10 : 0,
      coverage: { item: roundCents(c.covItem), category: roundCents(c.covCat), none: roundCents(c.covNone) },
      l3Rows,
    });
  }

  categories.sort((a, b) => b.netSales - a.netSales);

  for (const c of categories) {
    c.pctQty = totalQty > 0 ? Math.round((c.qty / totalQty) * 1000) / 10 : 0;
    if (c.l3Rows && c.l3Rows.length) {
      for (const l of c.l3Rows) {
        l.pctQty = totalQty > 0 ? Math.round((l.qty / totalQty) * 1000) / 10 : 0;
      }
    }
  }

  const totalGp = totalNet - totalCost;
  return {
    store, date: dateStr,
    categories,
    totals: {
      qty: Math.round(totalQty),
      gross: roundCents(totalGross),
      discounts: roundCents(totalDisc),
      refunds: roundCents(totalRef),
      netSales: roundCents(totalNet),
      asp: totalQty > 0 ? roundCents(totalNet / totalQty) : 0,
      cost: roundCents(totalCost),
      grossProfit: roundCents(totalGp),
      gpmPct: totalNet > 0 ? Math.round((totalGp / totalNet) * 1000) / 10 : 0,
      coverage: { item: roundCents(totCovItem), category: roundCents(totCovCat), none: roundCents(totCovNone) },
    },
    orderCount: allElements.length,
    channels: {
      retail: {
        net: roundCents(_ch.retail.net), units: Math.round(_ch.retail.units), orders: _ch.retail.orders,
        avgCart: _ch.retail.orders > 0 ? roundCents(_ch.retail.net / _ch.retail.orders) : 0,
        avgItems: _ch.retail.orders > 0 ? Math.round(_ch.retail.units / _ch.retail.orders * 10) / 10 : 0,
        asp: _ch.retail.units > 0 ? roundCents(_ch.retail.net / _ch.retail.units) : 0,
      },
      bin: {
        net: roundCents(_ch.bin.net), units: Math.round(_ch.bin.units), orders: _ch.bin.orders,
        avgCart: _ch.bin.orders > 0 ? roundCents(_ch.bin.net / _ch.bin.orders) : 0,
        avgItems: _ch.bin.orders > 0 ? Math.round(_ch.bin.units / _ch.bin.orders * 10) / 10 : 0,
        asp: _ch.bin.units > 0 ? roundCents(_ch.bin.net / _ch.bin.units) : 0,
      },
    },
    _debug: {
      unmappedL3, noCategory,
      itemCatMapSize: Object.keys(itemCatMap).length,
      itemCostsCount: Object.keys(icItems).length,
    },
  };
}

// ─── Fetch orders with lineItems for item sales ─────────────────
// Optional untilTimestamp adds a createdTime< upper bound (needed for historical re-snapshot)
async function fetchItemOrders(store, env, sinceTimestamp, untilTimestamp = null) {
  const merchantId = env[`${store}_MERCHANT_ID`];
  const apiToken = env[`${store}_API_TOKEN`];
  if (!merchantId || !apiToken) return null;

  const allElements = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    let cloverUrl = `https://api.clover.com/v3/merchants/${merchantId}/orders`
      + `?filter=createdTime>=${sinceTimestamp}`
      + `&filter=state=locked`
      + `&expand=payments,lineItems.item,lineItems.discounts,discounts`
      + `&limit=${limit}&offset=${offset}`;
    if (untilTimestamp) cloverUrl += `&filter=createdTime<${untilTimestamp}`;
    const resp = await fetch(cloverUrl, {
      headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
    });
    const data = await resp.json();
    if (!data?.elements?.length) break;
    allElements.push(...data.elements);
    if (data.elements.length < limit) break;
    offset += limit;
  }
  return allElements;
}

// ─── Fetch specific orders by ID (parallel) ─────────────────────
// Used to resolve cross-day refunds: refunds reference orders, but if the
// original order is from a prior day it won't be in today's fetch window.
// We fetch each missing order individually with full line-item details so
// the refund can be attributed to the original product categories instead
// of dumping into a generic "Refund" L2 bucket.
async function fetchOrdersByIds(store, env, orderIds) {
  if (!orderIds?.length) return [];
  const merchantId = env[`${store}_MERCHANT_ID`];
  const apiToken = env[`${store}_API_TOKEN`];
  if (!merchantId || !apiToken) return [];

  const headers = { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" };
  const results = await Promise.allSettled(orderIds.map(async (id) => {
    const url = `https://api.clover.com/v3/merchants/${merchantId}/orders/${id}`
      + `?expand=lineItems.item,lineItems.discounts,discounts,payments`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  }));
  return results
    .filter(r => r.status === "fulfilled" && r.value)
    .map(r => r.value);
}

// ─── Identify + fetch cross-day refund source orders ────────────
// Given today's fetched orders and refund elements, returns the orders
// referenced by refunds whose original sale is NOT in today's fetch
// (i.e. true cross-day refunds). Caller passes the result to
// aggregateItemSales as extraOrdersForRefundLookup.
async function fetchCrossDayOrdersForRefunds(store, env, elements, refundElements) {
  if (!refundElements?.length) return [];
  const todayOrderIds = new Set();
  for (const o of (elements || [])) {
    if (o?.id) todayOrderIds.add(o.id);
  }
  const crossDayIds = new Set();
  for (const r of refundElements) {
    const oid = r.orderRef?.id || r.payment?.order?.id;
    if (oid && !todayOrderIds.has(oid)) crossDayIds.add(oid);
  }
  if (crossDayIds.size === 0) return [];
  return await fetchOrdersByIds(store, env, [...crossDayIds]);
}

// ─── Save a snapshot to KV + D1 ─────────────────────────────────
async function saveSnapshot(env, store, dateStr, data) {
  const snapshotTime = new Date().toISOString();

  // Write to KV (cache for live dashboard reads). D1 is the durable
  // source-of-truth for daily_sales totals — if KV write fails (e.g.
  // daily put quota exceeded on Workers Free), don't bail the snapshot;
  // D1 still gets the truth.
  if (env.SALES_SNAPSHOTS) {
    const key = `sales:${store.toLowerCase()}:${dateStr}`;
    try {
      await env.SALES_SNAPSHOTS.put(key, JSON.stringify({ ...data, snapshotTime }));
    } catch (e) {
      console.warn(`KV put failed for ${key}: ${e.message}`);
    }
  }

  // Write to D1
  if (env.DB) {
    try { await env.DB.prepare('ALTER TABLE daily_sales ADD COLUMN avg_asp REAL').run(); } catch {}
    try {
      await env.DB.prepare(
        `INSERT INTO daily_sales (store, date, total, retail, bin, order_count, avg_cart, avg_items, avg_txn_sec, avg_asp, snapshot_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(store, date) DO UPDATE SET
           total=excluded.total, retail=excluded.retail, bin=excluded.bin,
           order_count=excluded.order_count, avg_cart=excluded.avg_cart,
           avg_items=excluded.avg_items, avg_txn_sec=excluded.avg_txn_sec,
           avg_asp=excluded.avg_asp,
           snapshot_time=excluded.snapshot_time,
           budget=COALESCE(budget, excluded.budget),
           labor_pct=COALESCE(labor_pct, excluded.labor_pct),
           auction=COALESCE(auction, excluded.auction),
           week=COALESCE(week, excluded.week)`
      ).bind(
        store.toUpperCase(), dateStr,
        data.total ?? null, data.retail ?? null, data.bin ?? null,
        data.orderCount ?? null, data.avgCart ?? null, data.avgItems ?? null,
        data.avgTxnSec != null ? Math.round(data.avgTxnSec) : null,
        data.avgASP != null ? Math.round(data.avgASP * 100) / 100 : null,
        snapshotTime
      ).run();
    } catch (e) {
      console.error(`D1 write failed for ${store} ${dateStr}:`, e.message);
    }
  }
}

// ─── Apply refund subtraction to aggregated totals ───────────────
// Mutates `data` to subtract refundCents proportionally across total /
// retail / bin so the split adds up. Stores the original total and the
// refund amount as metadata for auditability.
function applyRefundsToAggregate(data, refundCents) {
  if (!refundCents || refundCents <= 0) return data;
  const refundDollars = refundCents / 100;
  const totalBefore = data.total;
  data.totalBeforeRefunds = +totalBefore.toFixed(2);
  data.refundsSubtracted = +refundDollars.toFixed(2);
  data.total = +(totalBefore - refundDollars).toFixed(2);
  if (totalBefore > 0) {
    const retailShare = data.retail / totalBefore;
    const binShare = data.bin / totalBefore;
    data.retail = +(data.retail - refundDollars * retailShare).toFixed(2);
    data.bin = +(data.bin - refundDollars * binShare).toFixed(2);
  }
  return data;
}

// ─── Fetch and aggregate for a store, then snapshot ──────────────
async function fetchAggregateAndSnapshot(store, env, sinceTimestamp, dateStr, untilTimestamp = null, binRetailOverride = null, preElements = null) {
  // preElements: when provided (e.g. the clientCreatedTime sweep), skip the
  // createdTime fetch and aggregate this exact set instead. Default (null) is
  // byte-identical to the original behavior.
  const elements = preElements || await fetchCloverOrders(store, env, sinceTimestamp, untilTimestamp);
  if (!elements) return null;

  const data = aggregateOrders(elements, sinceTimestamp);

  // Phase 2G: aggregateOrders now uses payment.amount (ORIGINAL pre-refund net)
  // instead of order.total. That means same-day refunds are NOT reflected in
  // data.total — they need to be subtracted explicitly here. Pass null for
  // sameDayOrders so fetchRefundsTotal returns ALL refunds (same-day + cross-day),
  // not just cross-day. Without this, refunded orders contribute their original
  // pre-refund revenue and the refund deduction would be missing.
  const refundCents = await fetchRefundsTotal(store, env, sinceTimestamp, untilTimestamp, null);
  applyRefundsToAggregate(data, refundCents);

  // Phase 2D: when caller provides category-based bin/retail (computed via
  // aggregateItemSales using Clover's L3 category map), override the name-based
  // split from aggregateOrders. This keeps D1 daily_sales bin/retail aligned
  // with the Item Sales tab — they otherwise diverge because aggregateOrders
  // uses isBinItem() name regex while aggregateItemSales uses Clover categories.
  if (binRetailOverride && typeof binRetailOverride.bin === 'number' && typeof binRetailOverride.retail === 'number') {
    data.bin = +binRetailOverride.bin.toFixed(2);
    data.retail = +binRetailOverride.retail.toFixed(2);

    // Phase 3: also adopt the category-derived TOTAL when provided. After the
    // Phase 2H fix both totals should agree, but this makes the relationship
    // explicit: D1.total = sum of all category netSales (visible in the Item
    // Sales tab) = D1.bin + D1.retail + other categories. Logs a warning if
    // the values drift more than a dollar so future regressions are obvious.
    if (typeof binRetailOverride.total === 'number') {
      const drift = Math.abs(data.total - binRetailOverride.total);
      if (drift > 1) {
        console.warn(
          `[aggregator-drift] ${store}/${dateStr}: aggregateOrders=$${data.total.toFixed(2)} ` +
          `vs aggregateItemSales=$${binRetailOverride.total.toFixed(2)} ` +
          `(diff $${drift.toFixed(2)}) — using item-sales value for D1.total`
        );
      }
      data.total = +binRetailOverride.total.toFixed(2);
    }
  }

  // Defensive guards before persisting:
  //  1) If row is_manual_override = 1, NEVER overwrite (admin entered
  //     real numbers manually because Clover lost the data).
  //  2) If Clover returned 0 orders AND we already have a non-zero
  //     daily_sales row, refuse to overwrite — protects against
  //     transient empty responses silently zeroing or negating real revenue.
  //     IMPORTANT: when orders = 0 but refunds exist, Phase 2A produces a
  //     NEGATIVE total. The guard must check orderCount === 0, not just
  //     total === 0, to catch that case.
  if (env.DB) {
    try {
      const existing = await env.DB.prepare(
        "SELECT total, is_manual_override FROM daily_sales WHERE store = ? AND date = ?"
      ).bind(store.toUpperCase(), dateStr).first();

      if (existing && existing.is_manual_override) {
        console.warn(`Skipping manual-override row for ${store}/${dateStr}`);
        data.skippedManualOverride = true;
        data.total = existing.total;
        return data;
      }
      // Guard: if no real orders came back (orderCount === 0), don't write.
      // When Clover returns 0 orders for a historical day but refunds exist,
      // Phase 2A produces a negative total — that's always wrong for a daily
      // sales figure and must never be persisted regardless of existing data.
      const noRealOrders = data.orderCount != null && data.orderCount === 0;
      if (noRealOrders) {
        console.warn(`Skipping zero-order write for ${store}/${dateStr}: orderCount=${data.orderCount}, computedTotal=${data.total}`);
        data.skippedZeroOverwrite = true;
        data.total = existing?.total ?? null;
        return data;
      }
      // Secondary guard: a negative computed total (e.g. 1 tiny order + big
      // refund) is almost certainly a partial fetch. Protect existing good data.
      if (data.total < 0 && existing && existing.total != null && existing.total > 0) {
        console.warn(`Skipping negative-overwrite for ${store}/${dateStr}: computedTotal=${data.total}, existingTotal=${existing.total}`);
        data.skippedZeroOverwrite = true;
        data.total = existing.total;
        return data;
      }
    } catch (e) {
      console.warn(`pre-save guard query failed for ${store}/${dateStr}:`, e.message);
    }
  }

  await saveSnapshot(env, store, dateStr, data);
  return data;
}

// ─── Re-snapshot one ET day, bucketed by clientCreatedTime ───────────
// The normal pipeline buckets by Clover createdTime (server receipt time). When
// a register runs offline (e.g. power outage) its orders only reach Clover on
// sync — often the next day — so they land on the wrong day. This re-snapshots
// `dateStr` using clientCreatedTime (the register's local clock = actual sale
// time): it fetches a WIDE createdTime window [dateStr 00:00, dateStr+look+1)
// so late-synced orders are captured, keeps only those whose clientCreatedTime
// is dateStr, then runs the exact same aggregate / guard / persist path as the
// nightly snapshot. Honors the manual-override and zero-order guards. Returns
// the snapshot result (or null if the store has no creds / fetch failed).
async function snapshotDayByClientTime(store, env, dateStr, lookForwardDays = 3) {
  const etDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms));
  const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const dayStart = getStartOfDayET(dateStr);
  const dayEnd = getStartOfDayET(addDays(dateStr, 1));
  const wideUntil = getStartOfDayET(addDays(dateStr, lookForwardDays + 1));

  // Wide fetch (catch late syncs), then keep only this day's actual sales.
  const wide = await fetchItemOrders(store, env, dayStart, wideUntil);
  if (!wide) return null;
  const bucket = wide.filter(o =>
    etDay(o.clientCreatedTime != null ? o.clientCreatedTime : o.createdTime) === dateStr
  );

  // Category-based bin/retail/total (same derivation as the nightly cron), and
  // refresh the item-sales snapshot so the Item Sales tab stays correct too.
  let binRetailOverride = null, itemData = null;
  try {
    const itemCatMap = await fetchItemCategoryMap(store, env);
    const [overrides, itemCosts] = await Promise.all([fetchItemOverrides(env), fetchItemCosts(env)]);
    const refundElements = await fetchRefundElements(store, env, dayStart, dayEnd);
    const manualRefundElements = await fetchManualRefunds(store, env, dayStart, dayEnd);
    const extraOrders = await fetchCrossDayOrdersForRefunds(store, env, bucket, refundElements);
    itemData = aggregateItemSales(bucket, itemCatMap, store, dateStr, overrides, itemCosts, refundElements, extraOrders, manualRefundElements);
    let binNet = 0, retailNet = 0;
    for (const c of (itemData.categories || [])) {
      if (c.category === "Bin Products") binNet += c.netSales; else retailNet += c.netSales;
    }
    binRetailOverride = { bin: binNet, retail: retailNet, total: itemData.totals?.netSales };
  } catch (e) {
    console.warn(`[clienttime-sweep] item prep failed ${store}/${dateStr}: ${e.message}`);
  }

  // Reuse the canonical snapshot writer with our pre-filtered bucket. Pass the
  // day window so refunds + the aggregateOrders createdTime guard use [D, D+1).
  const data = await fetchAggregateAndSnapshot(store, env, dayStart, dateStr, dayEnd, binRetailOverride, bucket);

  if (itemData && data && !data.skippedManualOverride) {
    try { await saveItemSalesSnapshot(env, store, dateStr, itemData); } catch (e) {
      console.warn(`[clienttime-sweep] item snapshot save failed ${store}/${dateStr}: ${e.message}`);
    }
  }
  return data ? { ...data, bucketOrders: bucket.length, wideOrders: wide.length } : null;
}

// ─── CORS headers ────────────────────────────────────────────────
// Allowlist-based CORS. Echoes the matching Origin back so that Phase 2 can
// enable Access-Control-Allow-Credentials for session cookies without a
// second CORS refactor. Unknown origins get no Allow-Origin header and the
// browser blocks the response.
const ALLOWED_ORIGINS = [
  "https://www.retjghub.com",
  "https://retjghub.com",
  "https://staging.retjghub.com",
];
// localhost on any port for dev (http://localhost:1234, http://127.0.0.1:5500, etc.)
const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// Environment-driven hosts. Unset (prod) → prod literals, so prod behavior is
// byte-identical. Set per-env in wrangler.toml [env.staging.vars].
function appOrigin(env)  { return (env && env.APP_ORIGIN) || "https://www.retjghub.com"; }
function apiOrigin(env)  { return (env && env.API_ORIGIN) || "https://api.retjghub.com"; }
// A clientDataJSON origin is acceptable if it's an allowlisted host (covers
// www + staging) or localhost. Replaces the old single-origin equality check.
function isAllowedWebauthnOrigin(o) { return ALLOWED_ORIGINS.includes(o) || LOCALHOST_RE.test(o); }

function resolveCors(request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) || LOCALHOST_RE.test(origin);
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Snapshot-Secret",
    "Vary": "Origin",
  };
  if (allowed) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}

// Returns a 401 Response if the request lacks a valid admin secret, else null.
// Every secret-gated endpoint uses this to avoid drifting auth checks.
function requireAdminSecret(request, env, corsJson) {
  if (!env.SNAPSHOT_SECRET || request.headers.get("X-Snapshot-Secret") !== env.SNAPSHOT_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsJson });
  }
  return null;
}

// Round to 2 decimal places (dollar/cents precision).
const roundCents = n => Math.round(n * 100) / 100;

// ─── Auth helpers ─────────────────────────────────────────────────

// ─── Daily notification helpers ──────────────────────────────────────────────

const STORE_LABELS = {
  BL1: 'Coliseum', BL2: 'South Bend', BL4: 'Dupont',
  BL8: 'Holland', BL12: 'Wyoming', BL14: 'Battle Creek',
};

// Attribute a Meta campaign to a store/location by keyword-matching its name.
// Most specific first (Coliseum/Dupont before the generic "Fort Wayne").
// Brand-wide campaigns with no location keyword → "Unattributed".
const STORE_KEYWORDS = [
  ['Coliseum', /coliseum/i],
  ['Dupont', /dupont/i],
  ['South Bend', /south\s*bend/i],
  ['Holland', /holland/i],
  ['Wyoming', /wyoming/i],
  ['Battle Creek', /battle\s*creek/i],
  ['Indianapolis', /indianapol|\bindy\b/i],
  ['Lansing', /lansing/i],
  ['Fort Wayne', /fort\s*wayne/i],
];
function campaignStore(name) {
  const n = name || '';
  for (const [label, re] of STORE_KEYWORDS) if (re.test(n)) return label;
  return 'Unattributed';
}

// Reliable store attribution: each store has its own Facebook Page, so the
// page a boosted post came from maps cleanly to a store — unlike the truncated
// post text in the campaign name. Populated after discovery (page_id → store).
// Takes precedence over campaignStore(name) in marketing-insights.
// Discovered 2026-06-30 by correlating page_id with keyword-attributable
// campaigns (+ user confirmation for Holland, whose posts never name it).
// Page 113655020488471 is a SHARED page (Coliseum/Dupont/Fort Wayne) so it is
// deliberately NOT mapped — those fall back to campaignStore(name).
const STORE_BY_PAGE = {
  "264627006733058": "South Bend",
  "104574708111472": "Battle Creek",
  "1000209416518542": "Indianapolis",
  "222962777911366": "Holland",
};
function storeByPage(pageId) {
  return pageId ? (STORE_BY_PAGE[String(pageId)] || null) : null;
}

// ─── Phase 2: live Meta Marketing API ingest ─────────────────────────────────
// Pulls insights from graph.facebook.com directly (the worker can't use the
// session-only Meta MCP) and upserts into meta_ad_insights, replacing the
// Phase-1 snapshot. Configured via secrets: META_ACCESS_TOKEN (required),
// optional META_AD_ACCOUNTS (csv) and META_API_VERSION.
const META_API_VERSION = "v25.0";
const META_ACCOUNT_NAMES = {
  "273307252412674": "Brian Howard",
  "900771016120912": "Bargain Lane - Ad Account 2",
};
const META_WINDOWS = { "7d": "last_7d", "14d": "last_14d", "30d": "last_30d", "90d": "last_90d" };
const META_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function fmtMetaDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || null;
  const [y, m, d] = iso.split("-");
  return `${META_MONTHS[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`;
}
const metaNum = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const metaInt = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };

// One paginated Insights call. Throws on a Graph API error (e.g. bad token).
async function metaInsightsCall(ver, token, acct, level, preset, fields) {
  const params = new URLSearchParams({ level, date_preset: preset, fields: fields.join(","), limit: "500", access_token: token });
  let url = `https://graph.facebook.com/${ver}/act_${acct}/insights?${params}`;
  const out = [];
  for (let page = 0; page < 12 && url; page++) {
    const resp = await fetch(url);
    const json = await resp.json();
    if (json.error) throw new Error(`${json.error.code || ""} ${json.error.message || JSON.stringify(json.error)}`.trim());
    if (Array.isArray(json.data)) out.push(...json.data);
    url = json.paging && json.paging.next ? json.paging.next : null;
  }
  return out;
}

function mapMetaRow(r, acct, level, win, fetchedAt) {
  const isAcct = level === "account";
  return {
    account_id: acct,
    account_name: r.account_name || META_ACCOUNT_NAMES[acct] || null,
    level,
    entity_id: isAcct ? acct : String(r.campaign_id),
    entity_name: isAcct ? (r.account_name || META_ACCOUNT_NAMES[acct] || null) : (r.campaign_name || null),
    objective: isAcct ? null : (r.objective || null),
    window: win,
    date_start: fmtMetaDate(r.date_start),
    date_stop: fmtMetaDate(r.date_stop),
    spend: metaNum(r.spend),
    impressions: metaInt(r.impressions),
    reach: metaInt(r.reach),
    clicks: metaInt(r.clicks),
    link_clicks: metaInt(r.inline_link_clicks),
    cpc: metaNum(r.cpc),
    cpm: metaNum(r.cpm),
    ctr: metaNum(r.ctr),
    frequency: metaNum(r.frequency),
    fetched_at: fetchedAt,
  };
}

// Map campaign_id → Facebook page_id for an account, via each campaign's ad
// creative. effective_object_story_id is "{page_id}_{post_id}" for boosted
// posts. Used to attribute campaigns to stores by page (the page reliably maps
// to one store) rather than by parsing truncated post text in the campaign name.
// Defensive: any failure returns {} so the insights ingest proceeds unchanged.
async function fetchCampaignPages(ver, token, acct, diag) {
  const map = {};
  let ads = 0, withStory = 0;
  try {
    const params = new URLSearchParams({
      fields: "campaign_id,creative{effective_object_story_id}",
      limit: "500", access_token: token,
    });
    let url = `https://graph.facebook.com/${ver}/act_${acct}/ads?${params}`;
    for (let page = 0; page < 12 && url; page++) {
      const resp = await fetch(url);
      const json = await resp.json();
      if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
      for (const ad of (json.data || [])) {
        ads++;
        const cid = ad.campaign_id;
        const story = ad.creative && ad.creative.effective_object_story_id;
        if (!cid || !story) continue;
        withStory++;
        const pageId = String(story).split("_")[0];
        if (pageId && !map[cid]) map[cid] = pageId;   // first ad's page wins
      }
      url = json.paging && json.paging.next ? json.paging.next : null;
    }
  } catch (e) {
    if (diag) diag.push(`act_${acct} pages: ${e.message}`);
    console.warn(`fetchCampaignPages(act_${acct}):`, e.message);
  }
  if (diag) diag.push(`act_${acct}: ads=${ads} withStory=${withStory} mapped=${Object.keys(map).length}`);
  return map;
}

async function fetchMetaInsights(env) {
  if (!env.DB) return { error: "D1 not configured" };
  const token = env.META_ACCESS_TOKEN;
  if (!token) return { error: "META_ACCESS_TOKEN not set — generate a Meta system-user token (ads_read) and run: wrangler secret put META_ACCESS_TOKEN --env staging" };
  const ver = env.META_API_VERSION || META_API_VERSION;
  const accounts = (env.META_AD_ACCOUNTS || Object.keys(META_ACCOUNT_NAMES).join(","))
    .split(",").map(s => s.trim()).filter(Boolean);
  const acctFields = ["account_id", "account_name", "spend", "impressions", "reach", "clicks", "cpc", "cpm", "ctr", "frequency", "inline_link_clicks"];
  const campFields = ["campaign_id", "campaign_name", "objective", "spend", "impressions", "reach", "clicks", "cpc", "cpm", "ctr", "inline_link_clicks"];
  const fetchedAt = new Date().toISOString();
  const errors = [];
  const pageDiag = [];
  let written = 0;

  const stmt = env.DB.prepare(`INSERT OR REPLACE INTO meta_ad_insights
    (account_id, account_name, level, entity_id, entity_name, objective, window, date_start, date_stop, spend, impressions, reach, clicks, link_clicks, cpc, cpm, ctr, frequency, purchases, purchase_value, roas, page_id, fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,?,?)`);

  for (const acct of accounts) {
    // One campaign→page map per account, reused across all windows.
    const pageMap = await fetchCampaignPages(ver, token, acct, pageDiag);
    for (const [win, preset] of Object.entries(META_WINDOWS)) {
      try {
        const [acctRows, campRows] = await Promise.all([
          metaInsightsCall(ver, token, acct, "account", preset, acctFields),
          metaInsightsCall(ver, token, acct, "campaign", preset, campFields),
        ]);
        const rows = acctRows.map(r => ({ ...mapMetaRow(r, acct, "account", win, fetchedAt), page_id: null }))
          .concat(campRows.map(r => ({ ...mapMetaRow(r, acct, "campaign", win, fetchedAt), page_id: pageMap[String(r.campaign_id)] || null })));
        if (rows.length) {
          await env.DB.batch(rows.map(x => stmt.bind(
            x.account_id, x.account_name, x.level, x.entity_id, x.entity_name, x.objective, x.window,
            x.date_start, x.date_stop, x.spend, x.impressions, x.reach, x.clicks, x.link_clicks,
            x.cpc, x.cpm, x.ctr, x.frequency, x.page_id, x.fetched_at)));
          written += rows.length;
        }
      } catch (e) {
        errors.push(`act_${acct}/${win}: ${e.message}`);
      }
    }
  }
  return { ok: errors.length === 0, written, accounts: accounts.length, windows: Object.keys(META_WINDOWS).length, errors, pageDiag, fetchedAt };
}

// Returns { date, priorDate, stores: [{store,label,sales,budget,prior}], totals }
async function buildDailySummaryData(env, date) {
  const priorD = new Date(date + 'T12:00:00Z');
  priorD.setUTCDate(priorD.getUTCDate() - 7);
  const priorDate = priorD.toISOString().slice(0, 10);

  const [{ results: todayRows }, { results: priorRows }] = await Promise.all([
    env.DB.prepare('SELECT store, total, budget FROM daily_sales WHERE date = ? AND total IS NOT NULL').bind(date).all(),
    env.DB.prepare('SELECT store, total FROM daily_sales WHERE date = ? AND total IS NOT NULL').bind(priorDate).all(),
  ]);

  const todayMap = {}, priorMap = {};
  for (const r of (todayRows || [])) todayMap[r.store] = r;
  for (const r of (priorRows  || [])) priorMap[r.store] = r.total;

  let totalSales = 0, totalBudget = 0, totalPrior = 0;
  const stores = ALL_STORES.map(store => {
    const row    = todayMap[store] || {};
    const sales  = row.total  ?? null;
    const budget = row.budget ?? null;
    const prior  = priorMap[store] ?? null;
    if (sales  != null) totalSales  += sales;
    if (budget != null) totalBudget += budget;
    if (prior  != null) totalPrior  += prior;
    return { store, label: STORE_LABELS[store] || store, sales, budget, prior };
  });

  return { date, priorDate, stores, totals: { sales: totalSales, budget: totalBudget, prior: totalPrior } };
}

function _fmtDollars(v) {
  if (v == null) return '—';
  return '$' + Math.round(v).toLocaleString('en-US');
}
function _fmtVsLW(sales, prior) {
  if (sales == null || prior == null || prior === 0) return '—';
  const pct = ((sales - prior) / prior) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}
function _fmtVsBudget(sales, budget) {
  if (sales == null || budget == null || budget === 0) return '—';
  const pct = (sales / budget) * 100;
  return `${pct.toFixed(0)}%`;
}
function _vsColor(sales, ref) {
  if (sales == null || ref == null || ref === 0) return '#888';
  return sales >= ref ? '#2d8a2d' : '#c0392b';
}

function buildSummaryEmailHtml(data) {
  const { date, stores, totals } = data;
  const displayDate = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const storeRows = stores.map(({ label, sales, budget, prior }) => `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:8px 14px;color:#333">${label}</td>
      <td style="padding:8px 14px;text-align:right;font-weight:600;color:#111">${_fmtDollars(sales)}</td>
      <td style="padding:8px 14px;text-align:right;color:${_vsColor(sales,prior)}">${_fmtVsLW(sales,prior)}</td>
      <td style="padding:8px 14px;text-align:right;color:${_vsColor(sales,budget)}">${_fmtVsBudget(sales,budget)}</td>
    </tr>`).join('');

  const { sales: ts, budget: tb, prior: tp } = totals;

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#fff">
      <img src="https://www.retjghub.com/BLlogo.svg" alt="Bargain Lane" style="height:44px;margin-bottom:20px">
      <h2 style="margin:0 0 4px;font-size:20px;color:#194975">Daily Sales Summary</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#666">${displayDate}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#3BB54A;color:#fff">
            <th style="padding:9px 14px;text-align:left;font-weight:600">Store</th>
            <th style="padding:9px 14px;text-align:right;font-weight:600">Net Sales</th>
            <th style="padding:9px 14px;text-align:right;font-weight:600">vs LW</th>
            <th style="padding:9px 14px;text-align:right;font-weight:600">vs Budget</th>
          </tr>
        </thead>
        <tbody>${storeRows}</tbody>
        <tfoot>
          <tr style="background:#f7f7f7;font-weight:700;border-top:2px solid #3BB54A">
            <td style="padding:9px 14px;color:#111">All Stores</td>
            <td style="padding:9px 14px;text-align:right;color:#111">${_fmtDollars(ts)}</td>
            <td style="padding:9px 14px;text-align:right;color:${_vsColor(ts,tp)}">${_fmtVsLW(ts,tp)}</td>
            <td style="padding:9px 14px;text-align:right;color:${_vsColor(ts,tb)}">${_fmtVsBudget(ts,tb)}</td>
          </tr>
        </tfoot>
      </table>
      <p style="margin-top:28px;font-size:12px;color:#aaa">
        <a href="https://www.retjghub.com" style="color:#3BB54A;text-decoration:none">Open Dashboard</a>
        &nbsp;·&nbsp; Bargain Lane Notification System
        &nbsp;·&nbsp; To stop receiving these, open Settings → Notifications.
      </p>
    </div>`;
}

// Fan out push + email daily summary to all opted-in superusers.
async function dispatchDailySummary(env, date) {
  if (!env.DB) return { error: 'DB not configured' };

  const data = await buildDailySummaryData(env, date);
  const { sales: ts, budget: tb, prior: tp } = data.totals;

  // Short push body
  const budgetLine = tb > 0 ? ` • Budget: ${_fmtVsBudget(ts, tb)}` : '';
  const pushPayload = JSON.stringify({
    title: `Sales Summary — ${new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`,
    body: `${_fmtDollars(ts)} across all stores${budgetLine}`,
    tag: 'daily-summary',
    url: '/',
  });

  // All active users (notification_preferences controls per-user opt-in)
  const { results: superusers } = await env.DB.prepare(
    "SELECT u.id, u.email FROM users u WHERE u.status = 'active'"
  ).all();
  if (!superusers?.length) return { ok: true, skipped: 'no active users' };

  const userIds = superusers.map(u => u.id);
  const placeholders = userIds.map(() => '?').join(',');

  // Preferences (default: both enabled if no row)
  const { results: prefs } = await env.DB.prepare(
    `SELECT user_id, push_enabled, daily_summary FROM notification_preferences WHERE user_id IN (${placeholders})`
  ).bind(...userIds).all();
  const prefMap = {};
  for (const p of (prefs || [])) prefMap[p.user_id] = p;

  const summary = { push: { sent: 0, failed: 0, expired: 0 }, email: { sent: 0, failed: 0 } };
  const now = new Date().toISOString();

  for (const user of superusers) {
    const pref = prefMap[user.id] || { push_enabled: 1, daily_summary: 1 };
    if (!pref.daily_summary) continue;

    // ── Push ──────────────────────────────────────────────────────────────
    if (pref.push_enabled && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      const { results: subs } = await env.DB.prepare(
        'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?'
      ).bind(user.id).all();
      for (const sub of (subs || [])) {
        try {
          const res = await sendWebPush(env, sub, pushPayload);
          if (res.expired) {
            summary.push.expired++;
            await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run().catch(() => {});
          } else {
            summary.push.sent++;
          }
        } catch (e) {
          summary.push.failed++;
          console.error(`Push failed for ${user.email}:`, e.message);
        }
      }
    }

    // ── Email ─────────────────────────────────────────────────────────────
    if (pref.daily_summary && env.RESEND_API_KEY) {
      try {
        const displayDate = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'noreply@retjghub.com',
            to: user.email,
            subject: `Sales Summary — ${displayDate}`,
            html: buildSummaryEmailHtml(data),
          }),
        });
        if (res.ok) {
          summary.email.sent++;
        } else {
          const err = await res.text().catch(() => '');
          console.error(`Email failed for ${user.email}: ${res.status} ${err.slice(0,100)}`);
          summary.email.failed++;
        }
      } catch (e) {
        summary.email.failed++;
        console.error(`Email exception for ${user.email}:`, e.message);
      }
    }

    // Log one entry per user
    await env.DB.prepare(
      "INSERT INTO notification_log (id, user_id, type, event_type, status, created_at) VALUES (?, ?, 'push+email', 'daily-summary', 'sent', ?)"
    ).bind(randomHex(16), user.id, now).run().catch(() => {});
  }

  return { ok: true, date, summary };
}

// Returns { startDate, endDate, stores, totals } for a Mon–Sun week range.
async function buildWeeklyDigestData(env, startDate, endDate) {
  const priorStart = new Date(startDate + 'T12:00:00Z');
  priorStart.setUTCDate(priorStart.getUTCDate() - 7);
  const priorEnd = new Date(endDate + 'T12:00:00Z');
  priorEnd.setUTCDate(priorEnd.getUTCDate() - 7);
  const priorStartStr = priorStart.toISOString().slice(0, 10);
  const priorEndStr   = priorEnd.toISOString().slice(0, 10);

  const [{ results: thisWeek }, { results: priorWeek }] = await Promise.all([
    env.DB.prepare(
      `SELECT store, ROUND(SUM(total),2) AS sales, ROUND(SUM(budget),2) AS budget,
              SUM(order_count) AS orders
       FROM daily_sales WHERE date >= ? AND date <= ? AND total IS NOT NULL GROUP BY store`
    ).bind(startDate, endDate).all(),
    env.DB.prepare(
      `SELECT store, ROUND(SUM(total),2) AS sales
       FROM daily_sales WHERE date >= ? AND date <= ? AND total IS NOT NULL GROUP BY store`
    ).bind(priorStartStr, priorEndStr).all(),
  ]);

  const thisMap = {}, priorMap = {};
  for (const r of (thisWeek  || [])) thisMap[r.store]  = r;
  for (const r of (priorWeek || [])) priorMap[r.store] = r.sales;

  let totalSales = 0, totalBudget = 0, totalPrior = 0, totalOrders = 0;
  const stores = ALL_STORES.map(store => {
    const row    = thisMap[store] || {};
    const sales  = row.sales  ?? null;
    const budget = row.budget ?? null;
    const prior  = priorMap[store] ?? null;
    const orders = row.orders ?? null;
    if (sales  != null) totalSales  += sales;
    if (budget != null) totalBudget += budget;
    if (prior  != null) totalPrior  += prior;
    if (orders != null) totalOrders += orders;
    return { store, label: STORE_LABELS[store] || store, sales, budget, prior, orders };
  });
  return { startDate, endDate, stores, totals: { sales: totalSales, budget: totalBudget, prior: totalPrior, orders: totalOrders } };
}

function buildWeeklyDigestEmailHtml(data) {
  const { startDate, endDate, stores, totals } = data;
  const fmt = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const weekLabel = `${fmt(startDate)} – ${fmt(endDate)}, ${new Date(endDate + 'T12:00:00Z').getFullYear()}`;

  const storeRows = stores.map(({ label, sales, budget, prior, orders }) => `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:8px 14px;color:#333">${label}</td>
      <td style="padding:8px 14px;text-align:right;font-weight:600;color:#111">${_fmtDollars(sales)}</td>
      <td style="padding:8px 14px;text-align:right;color:${_vsColor(sales,prior)}">${_fmtVsLW(sales,prior)}</td>
      <td style="padding:8px 14px;text-align:right;color:${_vsColor(sales,budget)}">${_fmtVsBudget(sales,budget)}</td>
      <td style="padding:8px 14px;text-align:right;color:#555">${orders != null ? orders.toLocaleString('en-US') : '—'}</td>
    </tr>`).join('');

  const { sales: ts, budget: tb, prior: tp, orders: to } = totals;

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:620px;margin:0 auto;padding:32px 24px;background:#fff">
      <img src="https://www.retjghub.com/BLlogo.svg" alt="Bargain Lane" style="height:44px;margin-bottom:20px">
      <h2 style="margin:0 0 4px;font-size:20px;color:#194975">Weekly Sales Digest</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#666">${weekLabel}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#194975;color:#fff">
            <th style="padding:9px 14px;text-align:left;font-weight:600">Store</th>
            <th style="padding:9px 14px;text-align:right;font-weight:600">Net Sales</th>
            <th style="padding:9px 14px;text-align:right;font-weight:600">vs LW</th>
            <th style="padding:9px 14px;text-align:right;font-weight:600">vs Budget</th>
            <th style="padding:9px 14px;text-align:right;font-weight:600">Orders</th>
          </tr>
        </thead>
        <tbody>${storeRows}</tbody>
        <tfoot>
          <tr style="background:#f7f7f7;font-weight:700;border-top:2px solid #194975">
            <td style="padding:9px 14px;color:#111">All Stores</td>
            <td style="padding:9px 14px;text-align:right;color:#111">${_fmtDollars(ts)}</td>
            <td style="padding:9px 14px;text-align:right;color:${_vsColor(ts,tp)}">${_fmtVsLW(ts,tp)}</td>
            <td style="padding:9px 14px;text-align:right;color:${_vsColor(ts,tb)}">${_fmtVsBudget(ts,tb)}</td>
            <td style="padding:9px 14px;text-align:right;color:#555">${to != null ? to.toLocaleString('en-US') : '—'}</td>
          </tr>
        </tfoot>
      </table>
      <p style="margin-top:28px;font-size:12px;color:#aaa">
        <a href="https://www.retjghub.com" style="color:#3BB54A;text-decoration:none">Open Dashboard</a>
        &nbsp;·&nbsp; Bargain Lane Notification System
        &nbsp;·&nbsp; To stop receiving these, open Settings → Notifications.
      </p>
    </div>`;
}

async function dispatchWeeklyDigest(env, startDate, endDate) {
  if (!env.DB) return { error: 'DB not configured' };
  const data = await buildWeeklyDigestData(env, startDate, endDate);
  const { sales: ts, budget: tb, prior: tp } = data.totals;
  const fmt = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const budgetLine = tb > 0 ? ` • Budget: ${_fmtVsBudget(ts, tb)}` : '';
  const pushPayload = JSON.stringify({
    title: `Weekly Digest — ${fmt(startDate)}–${fmt(endDate)}`,
    body: `${_fmtDollars(ts)} this week${budgetLine}`,
    tag: 'weekly-digest',
    url: '/',
  });

  const { results: superusers } = await env.DB.prepare(
    "SELECT id, email FROM users WHERE status = 'active'"
  ).all();
  if (!superusers?.length) return { ok: true, skipped: 'no active users' };

  const userIds = superusers.map(u => u.id);
  const placeholders = userIds.map(() => '?').join(',');
  const { results: prefs } = await env.DB.prepare(
    `SELECT user_id, push_enabled, weekly_digest FROM notification_preferences WHERE user_id IN (${placeholders})`
  ).bind(...userIds).all();
  const prefMap = {};
  for (const p of (prefs || [])) prefMap[p.user_id] = p;

  const summary = { push: { sent: 0, failed: 0, expired: 0 }, email: { sent: 0, failed: 0 } };
  const now = new Date().toISOString();
  const weekLabel = `${fmt(startDate)}–${fmt(endDate)}, ${new Date(endDate + 'T12:00:00Z').getFullYear()}`;

  for (const user of superusers) {
    const pref = prefMap[user.id] || { push_enabled: 1, weekly_digest: 1 };
    if (!pref.weekly_digest) continue;

    // Push
    if (pref.push_enabled && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      const { results: subs } = await env.DB.prepare(
        'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?'
      ).bind(user.id).all();
      for (const sub of (subs || [])) {
        try {
          const res = await sendWebPush(env, sub, pushPayload);
          if (res.expired) {
            summary.push.expired++;
            await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run().catch(() => {});
          } else { summary.push.sent++; }
        } catch (e) { summary.push.failed++; console.error(`Weekly digest push failed ${user.email}:`, e.message); }
      }
    }

    // Email
    if (env.RESEND_API_KEY) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'noreply@retjghub.com',
            to: user.email,
            subject: `Weekly Sales Digest — ${weekLabel}`,
            html: buildWeeklyDigestEmailHtml(data),
          }),
        });
        if (res.ok) { summary.email.sent++; }
        else { summary.email.failed++; console.error(`Weekly digest email failed ${user.email}: ${res.status}`); }
      } catch (e) { summary.email.failed++; }
    }

    await env.DB.prepare(
      "INSERT INTO notification_log (id, user_id, type, event_type, status, created_at) VALUES (?, ?, 'push+email', 'weekly-digest', 'sent', ?)"
    ).bind(randomHex(16), user.id, now).run().catch(() => {});
  }
  return { ok: true, startDate, endDate, summary };
}

// Push-only alert to superusers when the nightly snapshot cron has store errors.
async function dispatchCronFailureAlert(env, failedStores) {
  if (!env.DB || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
  const storeList = failedStores.join(', ');
  const payload = JSON.stringify({
    title: '⚠️ Snapshot Error',
    body: `${storeList} failed to snapshot. Check the dashboard.`,
    tag: 'cron-error',
    url: '/',
  });

  const { results: superusers } = await env.DB.prepare(
    "SELECT id FROM users WHERE role = 'superuser' AND status = 'active'"
  ).all();

  for (const user of (superusers || [])) {
    const { results: subs } = await env.DB.prepare(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?'
    ).bind(user.id).all();
    for (const sub of (subs || [])) {
      try {
        const res = await sendWebPush(env, sub, payload);
        if (res.expired) {
          await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run().catch(() => {});
        }
      } catch (e) { console.error('Cron failure push error:', e.message); }
    }
  }
}

// Push-only interval sales summary to opted-in users (1h or 3h cadence).
// Called from the "0 * * * *" cron. Each user only sees their permitted stores.
// Only fires between 10 AM and 8 PM ET (inclusive of the 10 AM tick, up to and including 8 PM).
async function dispatchIntervalSummary(env) {
  if (!env.DB || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;

  // Current ET hour (0-23) to decide window and 3h cadence
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const etHour = nowET.getHours();

  // Only send between 10 AM (10) and 8 PM (20) ET
  if (etHour < 10 || etHour > 20) return { ok: true, skipped: 'outside active window' };

  // Today's date string in ET for the sales query
  const todayET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(nowET);

  // Fetch today's running totals + budget from D1 for all stores
  const { results: rows } = await env.DB.prepare(
    `SELECT store, total, order_count, budget FROM daily_sales WHERE date = ? ORDER BY store`
  ).bind(todayET).all();
  const snapshotMap = {};
  for (const r of (rows || [])) snapshotMap[r.store] = r;

  // Pull all users with interval_summary != 'off' who have push_enabled
  const { results: users } = await env.DB.prepare(
    `SELECT u.id, u.email, u.role, u.stores, u.status,
            np.interval_summary, np.push_enabled
     FROM users u
     JOIN notification_preferences np ON np.user_id = u.id
     WHERE u.status = 'active'
       AND np.push_enabled = 1
       AND np.interval_summary != 'off'`
  ).all();

  if (!users?.length) return { ok: true, skipped: 'no opted-in users' };

  const summary = { sent: 0, skipped: 0 };

  for (const user of users) {
    // 3h users only fire at hours divisible by 3 within the window
    if (user.interval_summary === '3h' && etHour % 3 !== 0) { summary.skipped++; continue; }

    // Determine which stores this user can see
    const isSuper = user.role === 'superuser' || user.role === 'admin';
    let userStores;
    if (isSuper) {
      userStores = ALL_STORES;
    } else {
      let parsed = [];
      try { parsed = user.stores ? JSON.parse(user.stores) : []; } catch (_) {}
      userStores = ALL_STORES.filter(s => parsed.includes(s));
    }
    if (!userStores.length) { summary.skipped++; continue; }

    // Build summary lines (notification-preview-v3 format):
    //   All Stores $26.0K / $37.6K  -31%      ← compact $K headline
    //   Coliseum $10,214 / $11,899  -14%      ← full dollars per store
    //   ...
    const fmtMoney = v => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v || 0);
    // Compact $K form for the headline (matches the reviewed preview).
    const fmtK = v => {
      const n = Number(v) || 0;
      return Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(1)}K` : fmtMoney(n);
    };

    let chainSales = 0, chainBudget = 0;
    const storeLines = userStores.map(s => {
      const snap = snapshotMap[s];
      const label = STORE_LABELS[s] || s;
      if (!snap) return `${label} —`;
      const sales  = Number(snap.total)  || 0;
      const budget = Number(snap.budget) || 0;
      chainSales += sales;
      if (budget > 0) chainBudget += budget;
      if (budget > 0) {
        const diffPct = Math.round(((sales - budget) / budget) * 100);
        const sign = diffPct >= 0 ? '+' : '';
        return `${label} ${fmtMoney(sales)} / ${fmtMoney(budget)} ${sign}${diffPct}%`;
      }
      return `${label} ${fmtMoney(sales)}`;
    });

    // "All Stores" headline = sum across this user's permitted stores.
    let headline;
    if (chainBudget > 0) {
      const cPct = Math.round(((chainSales - chainBudget) / chainBudget) * 100);
      const cSign = cPct >= 0 ? '+' : '';
      headline = `All Stores ${fmtK(chainSales)} / ${fmtK(chainBudget)} ${cSign}${cPct}%`;
    } else {
      headline = `All Stores ${fmtK(chainSales)}`;
    }
    const lines = [headline, ...storeLines];

    const timeLabel = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });
    const payload = JSON.stringify({
      title: `Sales Update — ${timeLabel}`,
      body: lines.join('\n'),
      tag: 'interval-summary',
      url: '/?view=hourly',
    });

    // Fetch this user's subscriptions
    const { results: subs } = await env.DB.prepare(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?'
    ).bind(user.id).all();

    for (const sub of (subs || [])) {
      try {
        const res = await sendWebPush(env, sub, payload);
        if (res.expired) {
          await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run().catch(() => {});
        }
      } catch (e) { console.error('Interval summary push error:', e.message); }
    }
    summary.sent++;
  }

  return { ok: true, ...summary };
}

// ─── Supply Request helpers ──────────────────────────────────────────────────

// HTML email sent to superusers when a new supply request is submitted.
function buildSupplyRequestEmailHtml({ requesterEmail, store, priority, notes, items, requestId }) {
  const storeLabel = STORE_LABELS[store] || store;
  const priorityBadge = priority === 'urgent'
    ? '<span style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:700;text-transform:uppercase;">URGENT</span>'
    : '<span style="background:#6b7280;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;text-transform:uppercase;">Normal</span>';

  const itemRows = items.map(it => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #1e293b;color:#e2e8f0;">${it.category}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #1e293b;color:#e2e8f0;">${it.item_name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #1e293b;color:#e2e8f0;text-align:center;">${it.quantity} ${it.unit}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #1e293b;color:#94a3b8;">${it.notes || '—'}</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:24px 16px;">
  <div style="background:#1e3a5f;border-radius:12px 12px 0 0;padding:24px 28px;">
    <div style="font-size:13px;font-weight:700;color:#94a3b8;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">New Supply Request</div>
    <div style="font-size:26px;font-weight:800;color:#ffffff;margin-bottom:4px;">${storeLabel}</div>
    <div style="font-size:14px;color:#93c5fd;">Requested by ${requesterEmail}</div>
  </div>
  <div style="background:#1e293b;padding:20px 28px;">
    <div style="display:flex;gap:12px;margin-bottom:20px;align-items:center;">
      <span style="font-size:13px;color:#94a3b8;">Priority:</span> ${priorityBadge}
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <thead>
        <tr style="background:#0f172a;">
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;">Category</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;">Item</th>
          <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;">Qty</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;">Notes</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    ${notes ? `<div style="background:#0f172a;border-radius:8px;padding:14px 16px;margin-bottom:16px;"><div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Request Notes</div><div style="font-size:14px;color:#e2e8f0;">${notes}</div></div>` : ''}
  </div>
  <div style="background:#0f172a;border-radius:0 0 12px 12px;padding:16px 28px;text-align:center;">
    <div style="font-size:12px;color:#475569;">Bargain Lane Dashboard · Supply Requests</div>
  </div>
</div></body></html>`;
}

// HTML email sent to requester when their request status changes.
function buildStatusUpdateEmailHtml({ store, oldStatus, newStatus, note, requestId }) {
  const storeLabel = STORE_LABELS[store] || store;
  const statusColors = { pending: '#6b7280', under_review: '#d97706', on_hold: '#ea580c', ordered: '#16a34a' };
  const statusLabels = { pending: 'Pending', under_review: 'Under Review', on_hold: 'On Hold', ordered: 'Ordered' };
  const color = statusColors[newStatus] || '#6b7280';
  const label = statusLabels[newStatus] || newStatus;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:24px 16px;">
  <div style="background:#1e3a5f;border-radius:12px 12px 0 0;padding:24px 28px;">
    <div style="font-size:13px;font-weight:700;color:#94a3b8;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">Supply Request Update</div>
    <div style="font-size:26px;font-weight:800;color:#ffffff;margin-bottom:4px;">${storeLabel}</div>
  </div>
  <div style="background:#1e293b;padding:24px 28px;">
    <div style="font-size:15px;color:#e2e8f0;margin-bottom:20px;">Your supply request status has been updated.</div>
    <div style="display:flex;gap:24px;margin-bottom:20px;">
      <div>
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Previous Status</div>
        <div style="font-size:14px;color:#94a3b8;">${statusLabels[oldStatus] || oldStatus}</div>
      </div>
      <div style="font-size:20px;color:#475569;align-self:flex-end;margin-bottom:2px;">→</div>
      <div>
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">New Status</div>
        <div style="font-size:16px;font-weight:700;color:${color};">${label}</div>
      </div>
    </div>
    ${note ? `<div style="background:#0f172a;border-radius:8px;padding:14px 16px;"><div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Note from Admin</div><div style="font-size:14px;color:#e2e8f0;">${note}</div></div>` : ''}
  </div>
  <div style="background:#0f172a;border-radius:0 0 12px 12px;padding:16px 28px;text-align:center;">
    <div style="font-size:12px;color:#475569;">Bargain Lane Dashboard · Supply Requests</div>
  </div>
</div></body></html>`;
}

// Notify all superusers (push + email) when a new supply request is submitted.
async function notifySupplyRequestNew(env, { requestId, requesterId, requesterEmail, store, priority, notes, items }) {
  if (!env.DB) return;
  const storeLabel = STORE_LABELS[store] || store;
  const itemSummary = items.slice(0, 3).map(i => `${i.item_name} ×${i.quantity}`).join(', ')
    + (items.length > 3 ? ` +${items.length - 3} more` : '');
  const urgentPrefix = priority === 'urgent' ? '🚨 URGENT — ' : '';

  const suPushPayload = JSON.stringify({
    title: `${urgentPrefix}New Supply Request — ${storeLabel}`,
    body: `${requesterEmail}: ${itemSummary}`,
    tag: `supply-new-${requestId}`,
    url: '/index.html#supply-request',
  });

  // Notify superusers (respects supply_notifications preference)
  const { results: superusers } = await env.DB.prepare(
    "SELECT id, email FROM users WHERE role = 'superuser' AND status = 'active'"
  ).all();
  if (superusers?.length) {
    const userIds = superusers.map(u => u.id);
    const placeholders = userIds.map(() => '?').join(',');
    const { results: subs } = await env.DB.prepare(
      `SELECT ps.endpoint, ps.p256dh, ps.auth
       FROM push_subscriptions ps
       JOIN notification_preferences np ON np.user_id = ps.user_id
       WHERE ps.user_id IN (${placeholders}) AND np.push_enabled = 1 AND np.supply_notifications != 0`
    ).bind(...userIds).all();
    for (const sub of (subs || [])) {
      try {
        const res = await sendWebPush(env, sub, suPushPayload);
        if (res.expired) {
          await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run().catch(() => {});
        }
      } catch (e) { console.error('Supply new push error:', e.message); }
    }

    // Email superusers
    if (env.RESEND_API_KEY) {
      const html = buildSupplyRequestEmailHtml({ requesterEmail, store, priority, notes, items, requestId });
      for (const u of superusers) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Bargain Lane Dashboard <noreply@retjghub.com>',
            to: u.email,
            subject: `${urgentPrefix}New Supply Request — ${storeLabel}`,
            html,
          }),
        }).catch(e => console.error('Supply email error:', e.message));
      }
    }
  }

  // Confirmation push to the requester (respects supply_notifications preference)
  if (requesterId) {
    const confirmPayload = JSON.stringify({
      title: `✅ Supply Request Received — ${storeLabel}`,
      body: `Your request (${itemSummary}) was submitted successfully.`,
      tag: `supply-confirm-${requestId}`,
      url: '/index.html#supply-request',
    });
    const { results: requesterSubs } = await env.DB.prepare(
      `SELECT ps.endpoint, ps.p256dh, ps.auth
       FROM push_subscriptions ps
       JOIN notification_preferences np ON np.user_id = ps.user_id
       WHERE ps.user_id = ? AND np.push_enabled = 1 AND np.supply_notifications != 0`
    ).bind(requesterId).all();
    for (const sub of (requesterSubs || [])) {
      try {
        const res = await sendWebPush(env, sub, confirmPayload);
        if (res.expired) {
          await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run().catch(() => {});
        }
      } catch (e) { console.error('Supply confirm push error:', e.message); }
    }
  }
}

// Notify the requester (push + email) when their request status changes.
async function notifySupplyStatusChange(env, { requestId, requesterId, requesterEmail, store, oldStatus, newStatus, note }) {
  if (!env.DB) return;
  const storeLabel = STORE_LABELS[store] || store;
  const statusLabels = { pending: 'Pending', under_review: 'Under Review', on_hold: 'On Hold', ordered: 'Ordered' };

  // Push
  const pushPayload = JSON.stringify({
    title: `Supply Request Update — ${storeLabel}`,
    body: `Status changed to ${statusLabels[newStatus] || newStatus}${note ? ': ' + note : ''}`,
    tag: `supply-status-${requestId}`,
    url: '/index.html#supply-request',
  });

  const { results: subs } = await env.DB.prepare(
    `SELECT ps.endpoint, ps.p256dh, ps.auth
     FROM push_subscriptions ps
     JOIN notification_preferences np ON np.user_id = ps.user_id
     WHERE ps.user_id = ? AND np.push_enabled = 1 AND np.supply_notifications != 0`
  ).bind(requesterId).all();

  for (const sub of (subs || [])) {
    try {
      const res = await sendWebPush(env, sub, pushPayload);
      if (res.expired) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run().catch(() => {});
      }
    } catch (e) { console.error('Supply status push error:', e.message); }
  }

  // Email
  if (env.RESEND_API_KEY && requesterEmail) {
    const html = buildStatusUpdateEmailHtml({ store, oldStatus, newStatus, note, requestId });
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Bargain Lane Dashboard <noreply@retjghub.com>',
        to: requesterEmail,
        subject: `Supply Request Update — ${storeLabel}`,
        html,
      }),
    }).catch(e => console.error('Supply status email error:', e.message));
  }
}

// Push alert to superusers when a store hits 80% of its monthly supply budget.
async function notifySupplyBudget80(env, { store, year, month, budget, spent }) {
  if (!env.DB || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
  const storeLabel = STORE_LABELS[store] || store;
  const pct = Math.round((spent / budget) * 100);
  const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long' });

  const pushPayload = JSON.stringify({
    title: `⚠️ Supply Budget Alert — ${storeLabel}`,
    body: `${monthName} budget is at ${pct}% ($${spent.toFixed(0)} of $${budget.toFixed(0)})`,
    tag: `supply-budget-${store}-${year}-${month}`,
    url: '/index.html#supply-request',
  });

  const { results: superusers } = await env.DB.prepare(
    "SELECT id FROM users WHERE role = 'superuser' AND status = 'active'"
  ).all();
  if (!superusers?.length) return;

  const userIds = superusers.map(u => u.id);
  const placeholders = userIds.map(() => '?').join(',');
  const { results: subs } = await env.DB.prepare(
    `SELECT ps.endpoint, ps.p256dh, ps.auth
     FROM push_subscriptions ps
     JOIN notification_preferences np ON np.user_id = ps.user_id
     WHERE ps.user_id IN (${placeholders}) AND np.push_enabled = 1 AND np.supply_notifications != 0`
  ).bind(...userIds).all();

  for (const sub of (subs || [])) {
    try {
      const res = await sendWebPush(env, sub, pushPayload);
      if (res.expired) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run().catch(() => {});
      }
    } catch (e) { console.error('Supply budget push error:', e.message); }
  }
}

// Push notification when someone adds a comment on a supply request.
// Superuser comment → notify the requester.
// Requester/manager comment → notify all superusers.
async function notifySupplyComment(env, { requestId, store, commenterId, commenterEmail, note, requesterId, requesterEmail }) {
  if (!env.DB) return;
  const storeLabel = STORE_LABELS[store] || store;
  const preview = note.length > 80 ? note.slice(0, 77) + '…' : note;
  const isSuperCommenter = commenterId !== requesterId;

  if (isSuperCommenter) {
    // Superuser commented — push to requester
    const pushPayload = JSON.stringify({
      title: `💬 Comment on your supply request — ${storeLabel}`,
      body: preview,
      tag: `supply-comment-${requestId}-${Date.now()}`,
      url: '/index.html#supply-request',
    });
    const { results: subs } = await env.DB.prepare(
      `SELECT ps.endpoint, ps.p256dh, ps.auth
       FROM push_subscriptions ps
       JOIN notification_preferences np ON np.user_id = ps.user_id
       WHERE ps.user_id = ? AND np.push_enabled = 1 AND np.supply_notifications != 0`
    ).bind(requesterId).all();
    for (const sub of (subs || [])) {
      try {
        const res = await sendWebPush(env, sub, pushPayload);
        if (res.expired) {
          await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run().catch(() => {});
        }
      } catch (e) { console.error('Supply comment push error:', e.message); }
    }
  } else {
    // Requester commented — push to all superusers
    const pushPayload = JSON.stringify({
      title: `💬 New comment on supply request — ${storeLabel}`,
      body: `${commenterEmail}: ${preview}`,
      tag: `supply-comment-${requestId}-${Date.now()}`,
      url: '/index.html#supply-request',
    });
    const { results: superusers } = await env.DB.prepare(
      "SELECT id FROM users WHERE role = 'superuser' AND status = 'active'"
    ).all();
    if (!superusers?.length) return;
    const userIds = superusers.map(u => u.id);
    const placeholders = userIds.map(() => '?').join(',');
    const { results: subs } = await env.DB.prepare(
      `SELECT ps.endpoint, ps.p256dh, ps.auth
       FROM push_subscriptions ps
       JOIN notification_preferences np ON np.user_id = ps.user_id
       WHERE ps.user_id IN (${placeholders}) AND np.push_enabled = 1 AND np.supply_notifications != 0`
    ).bind(...userIds).all();
    for (const sub of (subs || [])) {
      try {
        const res = await sendWebPush(env, sub, pushPayload);
        if (res.expired) {
          await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run().catch(() => {});
        }
      } catch (e) { console.error('Supply comment push error:', e.message); }
    }
  }
}

// ─── Web Push / RFC 8291 helpers ────────────────────────────────────────────

function base64urlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

function bytesToBase64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Build a VAPID JWT (ES256) for the given push endpoint origin.
async function buildVapidJwt(env, origin) {
  const now = Math.floor(Date.now() / 1000);
  const header  = btoa(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const payload = btoa(JSON.stringify({ aud: origin, exp: now + 43200, sub: env.VAPID_SUBJECT })).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const sigInput = `${header}.${payload}`;

  // Reconstruct JWK from raw pub/priv bytes
  const pub = base64urlToBytes(env.VAPID_PUBLIC_KEY);
  const x = bytesToBase64url(pub.slice(1, 33));
  const y = bytesToBase64url(pub.slice(33, 65));
  const sigKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE_KEY, x, y },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    sigKey,
    new TextEncoder().encode(sigInput)
  );
  return `${sigInput}.${bytesToBase64url(sig)}`;
}

// Encrypt a push message payload per RFC 8291 (aes128gcm content encoding).
async function encryptPushPayload(plaintext, p256dhB64, authB64) {
  const clientPub  = base64urlToBytes(p256dhB64); // 65-byte uncompressed P-256
  const authSecret = base64urlToBytes(authB64);   // 16-byte auth secret

  // Ephemeral sender key pair
  const senderKP = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );
  const senderPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', senderKP.publicKey));

  // ECDH shared secret
  const clientKey = await crypto.subtle.importKey(
    'raw', clientPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
  const ecdhBits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientKey }, senderKP.privateKey, 256
  ));

  // key_info = "WebPush: info\x00" || ua_public || as_public (RFC 8291 §3.3)
  const label   = new TextEncoder().encode('WebPush: info\x00');
  const keyInfo = new Uint8Array(label.length + 65 + 65);
  keyInfo.set(label, 0);
  keyInfo.set(clientPub, label.length);
  keyInfo.set(senderPubRaw, label.length + 65);

  // IKM = HKDF(IKM=ecdhBits, salt=authSecret, info=keyInfo, len=32)
  const ecdhKey = await crypto.subtle.importKey('raw', ecdhBits, 'HKDF', false, ['deriveBits']);
  const ikm = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: authSecret, info: keyInfo }, ecdhKey, 256
  ));

  // Random salt (16 bytes) — included in the encrypted body header
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // CEK and nonce via HKDF (RFC 8291 §3.4)
  const ikmKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const cek = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('Content-Encoding: aes128gcm\x00') },
    ikmKey, 128
  ));
  const nonce = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('Content-Encoding: nonce\x00') },
    ikmKey, 96
  ));

  // Encrypt: plaintext || 0x02 (single-record delimiter, no padding)
  const pt = new TextEncoder().encode(plaintext);
  const padded = new Uint8Array(pt.length + 1);
  padded.set(pt);
  padded[pt.length] = 0x02;

  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 }, cekKey, padded
  ));

  // aes128gcm body: salt(16) + rs(4,BE) + idlen(1) + keyid(65) + ciphertext
  const out = new Uint8Array(16 + 4 + 1 + 65 + ciphertext.length);
  out.set(salt, 0);
  new DataView(out.buffer).setUint32(16, 4096, false);
  out[20] = 65;
  out.set(senderPubRaw, 21);
  out.set(ciphertext, 86);
  return out;
}

// Send a Web Push message to a single subscription.
// subscription = { endpoint, p256dh, auth }; payload = JSON string or null
async function sendWebPush(env, subscription, payload) {
  const origin = new URL(subscription.endpoint).origin;
  const jwt    = await buildVapidJwt(env, origin);
  const authHeader = `vapid t=${jwt},k=${env.VAPID_PUBLIC_KEY}`;

  let body, contentHeaders;
  if (payload) {
    const encrypted = await encryptPushPayload(payload, subscription.p256dh, subscription.auth);
    body = encrypted;
    contentHeaders = { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm' };
  } else {
    body = null;
    contentHeaders = {};
  }

  const resp = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: { Authorization: authHeader, TTL: '86400', ...contentHeaders },
    body,
  });

  if (resp.status === 410 || resp.status === 404) return { ok: false, expired: true, status: resp.status };
  if (!resp.ok) {
    const err = await resp.text().catch(() => '');
    throw new Error(`Push ${resp.status}: ${err.slice(0, 120)}`);
  }
  return { ok: true, status: resp.status };
}

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── WebAuthn / Passkey Utilities ────────────────────────────────

/** Minimal CBOR decoder sufficient for WebAuthn attestationObject / COSE keys */
function decodeCBOR(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer.buffer);
  let offset = 0;

  function read8() { return bytes[offset++]; }
  function read16() { const v = (bytes[offset] << 8) | bytes[offset+1]; offset += 2; return v; }
  function read32() { const v = (bytes[offset]<<24|bytes[offset+1]<<16|bytes[offset+2]<<8|bytes[offset+3])>>>0; offset += 4; return v; }

  function decode() {
    const first = read8();
    const mt = (first & 0xe0) >> 5;
    const ai = first & 0x1f;
    let len;
    if (ai <= 23)      { len = ai; }
    else if (ai === 24){ len = read8(); }
    else if (ai === 25){ len = read16(); }
    else if (ai === 26){ len = read32(); }
    else if (ai === 27){ const hi=read32(), lo=read32(); len = hi*0x100000000+lo; }

    switch (mt) {
      case 0: return len;
      case 1: return -(len + 1);
      case 2: { const b = bytes.slice(offset, offset+len); offset+=len; return b; }
      case 3: { const b = bytes.slice(offset, offset+len); offset+=len; return new TextDecoder().decode(b); }
      case 4: { const a = []; for (let i=0;i<len;i++) a.push(decode()); return a; }
      case 5: { const m = {}; for (let i=0;i<len;i++) { const k=decode(); m[k]=decode(); } return m; }
      case 7: { if (ai===20) return false; if (ai===21) return true; if (ai===22) return null; break; }
    }
    throw new Error(`Unsupported CBOR: mt=${mt} ai=${ai}`);
  }
  return decode();
}

function bufToBase64url(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer);
  let s = '';
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i=0;i<a.length;i++) if (a[i]!==b[i]) return false;
  return true;
}

/** Convert DER-encoded ECDSA signature → IEEE P1363 (raw r||s, 64 bytes for P-256) */
function derToP1363(der) {
  let o = 0;
  if (der[o++] !== 0x30) throw new Error('Expected SEQUENCE');
  let seqLen = der[o++];
  if (seqLen & 0x80) { const lb = seqLen&0x7f; seqLen=0; for(let i=0;i<lb;i++) seqLen=(seqLen<<8)|der[o++]; }
  if (der[o++] !== 0x02) throw new Error('Expected INTEGER r');
  let rLen = der[o++]; let rStart = o; if (der[rStart]===0x00){rStart++;rLen--;} const r = der.slice(rStart, rStart+rLen); o = rStart+rLen;
  if (der[o++] !== 0x02) throw new Error('Expected INTEGER s');
  let sLen = der[o++]; let sStart = o; if (der[sStart]===0x00){sStart++;sLen--;} const s = der.slice(sStart, sStart+sLen);
  const out = new Uint8Array(64);
  out.set(r, 32 - r.length);
  out.set(s, 64 - s.length);
  return out;
}

/** Import a CBOR COSE ES256 public key for Web Crypto verify */
async function importCOSEPublicKey(coseBuf) {
  const coseKey = decodeCBOR(coseBuf instanceof Uint8Array ? coseBuf : new Uint8Array(coseBuf));
  const kty = coseKey[1], alg = coseKey[3], crv = coseKey[-1];
  const xBuf = coseKey[-2], yBuf = coseKey[-3];
  if (kty !== 2 || alg !== -7 || crv !== 1) throw new Error(`Unsupported COSE key kty=${kty} alg=${alg} crv=${crv}`);
  const jwk = { kty:'EC', crv:'P-256', x:bufToBase64url(xBuf), y:bufToBase64url(yBuf) };
  return crypto.subtle.importKey('jwk', jwk, { name:'ECDSA', namedCurve:'P-256' }, false, ['verify']);
}

const WEBAUTHN_RP_ID  = 'retjghub.com';

function getSessionCookie(request) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? match[1] : null;
}

// Returns user row or null.
async function getAuthUser(request, env) {
  if (!env.DB) return null;
  const sessionId = getSessionCookie(request);
  if (!sessionId) return null;
  const now = new Date().toISOString();
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.email, u.role, u.stores, u.status
     FROM sessions s JOIN users u ON s.user_id = u.id
     WHERE s.id = ? AND s.expires_at > ? AND u.status = 'active'`
  ).bind(sessionId, now).all();
  if (!results || !results.length) return null;
  const user = results[0];
  user.stores = user.stores ? JSON.parse(user.stores) : null;
  // Roll expiry 7 more days on each use (sliding window)
  const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
    .bind(newExpiry, sessionId).run().catch(() => {});
  return user;
}

// Returns null (= all stores) or string[] of allowed store codes.
function allowedStores(user) {
  if (!user) return null;
  if (user.role === 'superuser' || user.role === 'admin') return null;
  return user.stores || [];
}

function canAccessStore(user, store) {
  const allowed = allowedStores(user);
  if (allowed === null) return true;
  return allowed.includes(store);
}

// Roles that can access inventory / supply request pages.
function canAccessInventory(user) {
  return user && (user.role === 'superuser' || user.role === 'admin');
}

// Auth check for inventory/supply endpoints: accepts either a valid session
// with admin+ role, or the X-Snapshot-Secret header (for tooling/scripts).
function requireInventoryAccess(currentUser, isAdminSecret, corsJson) {
  if (isAdminSecret) return null;
  if (!currentUser || !canAccessInventory(currentUser)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsJson });
  }
  return null;
}

function sessionCookie(id, maxAge) {
  return `session=${id}; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=retjghub.com; Max-Age=${maxAge}`;
}

async function sendMagicLinkEmail(email, token, otpCode, env) {
  const link = `${apiOrigin(env)}/?action=auth-verify&token=${token}`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'noreply@retjghub.com',
      to: email,
      subject: 'Your Bargain Lane Dashboard login link',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
          <img src="https://www.retjghub.com/BLlogo.svg" alt="Bargain Lane" style="height:48px;margin-bottom:24px">
          <h2 style="margin:0 0 8px">Sign in to your dashboard</h2>
          <p style="color:#555;margin:0 0 24px">Click the button below to sign in. This link expires in 15 minutes and can only be used once.</p>
          <a href="${link}" style="display:inline-block;background:#3BB54A;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600">Sign in</a>
          <hr style="border:none;border-top:1px solid #eee;margin:28px 0">
          <p style="color:#555;font-size:14px;margin:0 0 8px"><strong>Using the mobile app?</strong> Enter this code instead:</p>
          <div style="font-size:36px;font-weight:700;letter-spacing:8px;color:#3BB54A;margin:8px 0 4px">${otpCode}</div>
          <p style="color:#999;font-size:12px;margin:0">Code expires in 15 minutes.</p>
          <p style="color:#999;font-size:12px;margin-top:24px">If you didn't request this, ignore this email.</p>
        </div>`,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error ${res.status}: ${err}`);
  }
}

async function sendInviteEmail(email, token, env) {
  const link = `${apiOrigin(env)}/?action=auth-verify&token=${token}`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'noreply@retjghub.com',
      to: email,
      subject: "You've been invited to Bargain Lane Dashboard",
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
          <img src="https://www.retjghub.com/BLlogo.svg" alt="Bargain Lane" style="height:48px;margin-bottom:24px">
          <h2 style="margin:0 0 8px">You've been invited</h2>
          <p style="color:#555;margin:0 0 24px">You've been given access to the Bargain Lane Dashboard. Click the button below to sign in and get started. This link expires in 24 hours.</p>
          <a href="${link}" style="display:inline-block;background:#3BB54A;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600">Accept Invite</a>
          <p style="color:#999;font-size:12px;margin-top:24px">If you weren't expecting this, you can ignore this email.</p>
        </div>`,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error ${res.status}: ${err}`);
  }
}

// ─── Worker export ───────────────────────────────────────────────
export default {
  // ── HTTP request handler ──────────────────────────────────────
  async fetch(request, env, ctx) {
    const corsHeaders = resolveCors(request);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const corsJson = { ...corsHeaders, "Content-Type": "application/json" };

    // ── Auth: POST /auth/login — send magic link ──────────────────
    if (request.method === "POST" && url.searchParams.get("action") === "auth-login") {
      try {
        const { email } = await request.json();
        if (!email || !email.includes('@')) {
          return new Response(JSON.stringify({ error: "Invalid email" }), { status: 400, headers: corsJson });
        }
        const normalized = email.trim().toLowerCase();
        // Look up user — respond generically whether found or not (don't leak existence)
        const { results } = await env.DB.prepare(
          "SELECT id FROM users WHERE email = ? AND status = 'active'"
        ).bind(normalized).all();
        if (results && results.length) {
          const token = randomHex(32);
          const otpCode = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit OTP
          const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
          await env.DB.prepare(
            "INSERT INTO magic_links (token, email, expires_at, otp_code) VALUES (?, ?, ?, ?)"
          ).bind(token, normalized, expires, otpCode).run();
          await sendMagicLinkEmail(normalized, token, otpCode, env);
        }
        return new Response(JSON.stringify({ ok: true }), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

    // ── Auth: GET /auth/verify — consume magic link, create session ──
    if (url.searchParams.get("action") === "auth-verify") {
      const token = url.searchParams.get("token");
      if (!token) return Response.redirect(`${appOrigin(env)}/?auth_error=invalid`, 302);
      try {
        const now = new Date().toISOString();
        const { results } = await env.DB.prepare(
          "SELECT email, expires_at, used_at FROM magic_links WHERE token = ?"
        ).bind(token).all();
        if (!results || !results.length || results[0].used_at || results[0].expires_at < now) {
          return Response.redirect(`${appOrigin(env)}/?auth_error=expired`, 302);
        }
        const { email } = results[0];
        // Mark token used
        await env.DB.prepare("UPDATE magic_links SET used_at = ? WHERE token = ?")
          .bind(now, token).run();
        // Load user
        const { results: users } = await env.DB.prepare(
          "SELECT id FROM users WHERE email = ? AND status = 'active'"
        ).bind(email).all();
        if (!users || !users.length) {
          return Response.redirect(`${appOrigin(env)}/?auth_error=nouser`, 302);
        }
        const userId = users[0].id;
        // Create session (7 days)
        const sessionId = randomHex(32);
        const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        await env.DB.prepare(
          "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
        ).bind(sessionId, userId, expiry, now).run();
        // Update last_login
        await env.DB.prepare("UPDATE users SET last_login = ? WHERE id = ?")
          .bind(now, userId).run();
        return new Response(null, {
          status: 302,
          headers: {
            "Location": `${appOrigin(env)}/`,
            "Set-Cookie": sessionCookie(sessionId, 7 * 24 * 60 * 60),
          },
        });
      } catch (e) {
        return Response.redirect(`${appOrigin(env)}/?auth_error=server`, 302);
      }
    }

    // ── Auth: POST ?action=auth-verify-otp — OTP code login for PWA ──
    if (request.method === "POST" && url.searchParams.get("action") === "auth-verify-otp") {
      try {
        const { email, otp } = await request.json();
        if (!email || !otp) {
          return new Response(JSON.stringify({ error: "Missing email or code" }), { status: 400, headers: corsJson });
        }
        const normalized = email.trim().toLowerCase();
        const now = new Date().toISOString();
        const { results } = await env.DB.prepare(
          "SELECT token FROM magic_links WHERE email = ? AND otp_code = ? AND expires_at > ? AND used_at IS NULL"
        ).bind(normalized, String(otp).trim(), now).all();
        if (!results || !results.length) {
          return new Response(JSON.stringify({ error: "Invalid or expired code" }), { status: 401, headers: corsJson });
        }
        const { token } = results[0];
        // Mark used
        await env.DB.prepare("UPDATE magic_links SET used_at = ? WHERE token = ?").bind(now, token).run();
        // Load user
        const { results: users } = await env.DB.prepare(
          "SELECT id FROM users WHERE email = ? AND status = 'active'"
        ).bind(normalized).all();
        if (!users || !users.length) {
          return new Response(JSON.stringify({ error: "Account not found" }), { status: 403, headers: corsJson });
        }
        const sessionId = randomHex(32);
        const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        await env.DB.prepare(
          "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
        ).bind(sessionId, users[0].id, expiry, now).run();
        await env.DB.prepare("UPDATE users SET last_login = ? WHERE id = ?").bind(now, users[0].id).run();
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsJson, "Set-Cookie": sessionCookie(sessionId, 7 * 24 * 60 * 60) },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

    // ── Auth: GET ?action=auth-me — return current user info ─────
    if (url.searchParams.get("action") === "auth-me") {
      const user = await getAuthUser(request, env);
      if (!user) {
        return new Response(JSON.stringify({ authenticated: false }), { headers: corsJson });
      }
      return new Response(JSON.stringify({
        authenticated: true,
        email: user.email,
        role: user.role,
        stores: user.stores,
      }), { headers: corsJson });
    }

    // ── Passkey: POST ?action=passkey-register-begin ─────────────
    // Requires active session. Generates challenge for credential creation.
    if (request.method === "POST" && url.searchParams.get("action") === "passkey-register-begin") {
      try {
        const user = await getAuthUser(request, env);
        if (!user) return new Response(JSON.stringify({error:"Not authenticated"}), {status:401,headers:corsJson});
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const challengeB64 = bufToBase64url(challenge);
        await env.SALES_SNAPSHOTS.put(`webauthn:reg:${user.id}`, challengeB64, { expirationTtl: 300 });
        const { results: existing } = await env.DB.prepare(
          "SELECT credential_id FROM webauthn_credentials WHERE user_id = ?"
        ).bind(user.id).all();
        const body2 = await request.json().catch(() => ({}));
        const deviceName = body2.deviceName || 'This device';
        await env.SALES_SNAPSHOTS.put(`webauthn:devname:${user.id}`, deviceName, { expirationTtl: 300 });
        return new Response(JSON.stringify({
          challenge: challengeB64,
          rp: { name: "RETJG Hub", id: WEBAUTHN_RP_ID },
          user: { id: bufToBase64url(new TextEncoder().encode(user.id)), name: user.email, displayName: user.email },
          pubKeyCredParams: [{ type:"public-key", alg:-7 }],
          authenticatorSelection: { authenticatorAttachment:"platform", userVerification:"required", residentKey:"preferred" },
          timeout: 60000,
          excludeCredentials: existing.map(c => ({ type:"public-key", id: c.credential_id })),
          attestation: "none",
        }), { headers: corsJson });
      } catch(e) {
        return new Response(JSON.stringify({error:e.message}), {status:500, headers:corsJson});
      }
    }

    // ── Passkey: POST ?action=passkey-register-finish ────────────
    if (request.method === "POST" && url.searchParams.get("action") === "passkey-register-finish") {
      try {
        const user = await getAuthUser(request, env);
        if (!user) return new Response(JSON.stringify({error:"Not authenticated"}), {status:401,headers:corsJson});
        const body2 = await request.json();
        const { id: credId, response: credResp } = body2;
        // Verify clientDataJSON
        const clientDataBytes = base64urlToBytes(credResp.clientDataJSON);
        const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes));
        if (clientData.type !== 'webauthn.create') throw new Error('Wrong type');
        if (!isAllowedWebauthnOrigin(clientData.origin)) throw new Error(`Bad origin: ${clientData.origin}`);
        const storedChallenge = await env.SALES_SNAPSHOTS.get(`webauthn:reg:${user.id}`);
        if (!storedChallenge || storedChallenge !== clientData.challenge) throw new Error('Challenge mismatch');
        await env.SALES_SNAPSHOTS.delete(`webauthn:reg:${user.id}`);
        const deviceName = (await env.SALES_SNAPSHOTS.get(`webauthn:devname:${user.id}`)) || 'This device';
        await env.SALES_SNAPSHOTS.delete(`webauthn:devname:${user.id}`);
        // Parse attestationObject
        const attObjBytes = base64urlToBytes(credResp.attestationObject);
        const attObj = decodeCBOR(attObjBytes);
        const authDataBytes = attObj['authData'] instanceof Uint8Array ? attObj['authData'] : new Uint8Array(attObj['authData']);
        // Verify RP ID hash (first 32 bytes of authData)
        const rpIdHash = authDataBytes.slice(0, 32);
        const expectedHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(WEBAUTHN_RP_ID)));
        if (!bytesEqual(rpIdHash, expectedHash)) throw new Error('RP ID hash mismatch');
        // Parse authenticatorData
        const flags = authDataBytes[32];
        const AT = !!(flags & 0x40);
        if (!AT) throw new Error('No attested credential data');
        const signCount = (authDataBytes[33]<<24|authDataBytes[34]<<16|authDataBytes[35]<<8|authDataBytes[36])>>>0;
        const credIdLen = (authDataBytes[53]<<8)|authDataBytes[54];
        const credentialId = bufToBase64url(authDataBytes.slice(55, 55+credIdLen));
        const coseKeyBytes = authDataBytes.slice(55+credIdLen);
        const publicKeyCose = bufToBase64url(coseKeyBytes);
        // Verify the key is importable
        await importCOSEPublicKey(coseKeyBytes);
        const now2 = new Date().toISOString();
        await env.DB.prepare(
          "INSERT OR REPLACE INTO webauthn_credentials (id, user_id, credential_id, public_key_cose, sign_count, created_at, device_name) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(randomHex(16), user.id, credentialId, publicKeyCose, signCount, now2, deviceName).run();
        return new Response(JSON.stringify({ ok: true }), { headers: corsJson });
      } catch(e) {
        return new Response(JSON.stringify({error: e.message}), {status:400, headers:corsJson});
      }
    }

    // ── Passkey: POST ?action=passkey-auth-begin ─────────────────
    // No session required (this is the login flow)
    if (request.method === "POST" && url.searchParams.get("action") === "passkey-auth-begin") {
      try {
        const body2 = await request.json().catch(() => ({}));
        const email = body2.email ? body2.email.toLowerCase().trim() : null;
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const challengeB64 = bufToBase64url(challenge);
        await env.SALES_SNAPSHOTS.put(`webauthn:auth:${challengeB64}`, '1', { expirationTtl: 300 });
        let allowCredentials = [];
        if (email) {
          const { results: creds } = await env.DB.prepare(
            "SELECT wc.credential_id FROM webauthn_credentials wc JOIN users u ON wc.user_id = u.id WHERE u.email = ? AND u.status = 'active'"
          ).bind(email).all();
          allowCredentials = creds.map(c => ({ type:'public-key', id: c.credential_id }));
        }
        return new Response(JSON.stringify({
          challenge: challengeB64,
          rpId: WEBAUTHN_RP_ID,
          allowCredentials,
          userVerification: 'required',
          timeout: 60000,
        }), { headers: corsJson });
      } catch(e) {
        return new Response(JSON.stringify({error:e.message}), {status:500, headers:corsJson});
      }
    }

    // ── Passkey: POST ?action=passkey-auth-finish ────────────────
    // No session required. Verifies assertion, creates session.
    if (request.method === "POST" && url.searchParams.get("action") === "passkey-auth-finish") {
      try {
        const body2 = await request.json();
        const { id: credId, response: credResp } = body2;
        // Verify clientDataJSON
        const clientDataBytes = base64urlToBytes(credResp.clientDataJSON);
        const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes));
        if (clientData.type !== 'webauthn.get') throw new Error('Wrong type');
        if (!isAllowedWebauthnOrigin(clientData.origin)) throw new Error(`Bad origin: ${clientData.origin}`);
        const storedChallenge = await env.SALES_SNAPSHOTS.get(`webauthn:auth:${clientData.challenge}`);
        if (!storedChallenge) throw new Error('Challenge expired or not found');
        await env.SALES_SNAPSHOTS.delete(`webauthn:auth:${clientData.challenge}`);
        // Look up credential + user
        const { results: creds } = await env.DB.prepare(
          `SELECT wc.id as wcId, wc.user_id, wc.credential_id, wc.public_key_cose, wc.sign_count,
                  u.email, u.role, u.stores, u.status
           FROM webauthn_credentials wc JOIN users u ON wc.user_id = u.id
           WHERE wc.credential_id = ? AND u.status = 'active'`
        ).bind(credId).all();
        if (!creds.length) return new Response(JSON.stringify({error:'Credential not found'}), {status:401,headers:corsJson});
        const cred = creds[0];
        // Verify RP ID hash
        const authDataBytes = base64urlToBytes(credResp.authenticatorData);
        const rpIdHash = authDataBytes.slice(0, 32);
        const expectedHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(WEBAUTHN_RP_ID)));
        if (!bytesEqual(rpIdHash, expectedHash)) throw new Error('RP ID hash mismatch');
        // Verify flags: UP required
        const flags = authDataBytes[32];
        if (!(flags & 0x01)) throw new Error('User presence flag not set');
        // Verify signature
        const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataBytes));
        const signedData = new Uint8Array(authDataBytes.length + clientDataHash.length);
        signedData.set(authDataBytes, 0);
        signedData.set(clientDataHash, authDataBytes.length);
        const coseKeyBytes = base64urlToBytes(cred.public_key_cose);
        const publicKey = await importCOSEPublicKey(coseKeyBytes);
        const sigBytes = base64urlToBytes(credResp.signature);
        const p1363Sig = derToP1363(sigBytes);
        const valid = await crypto.subtle.verify({ name:'ECDSA', hash:'SHA-256' }, publicKey, p1363Sig, signedData);
        if (!valid) throw new Error('Signature verification failed');
        // Update sign count + last_used
        const signCount = (authDataBytes[33]<<24|authDataBytes[34]<<16|authDataBytes[35]<<8|authDataBytes[36])>>>0;
        const now2 = new Date().toISOString();
        await env.DB.prepare("UPDATE webauthn_credentials SET sign_count=?, last_used=? WHERE id=?")
          .bind(signCount, now2, cred.wcId).run().catch(()=>{});
        await env.DB.prepare("UPDATE users SET last_login=? WHERE id=?").bind(now2, cred.user_id).run().catch(()=>{});
        // Create session
        const sessionId = randomHex(32);
        const expiry = new Date(Date.now() + 7*24*60*60*1000).toISOString();
        await env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
          .bind(sessionId, cred.user_id, expiry, now2).run();
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsJson, 'Set-Cookie': sessionCookie(sessionId, 7*24*60*60) },
        });
      } catch(e) {
        return new Response(JSON.stringify({error: e.message}), {status:400, headers:corsJson});
      }
    }

    // ── Passkey: GET ?action=passkey-list ────────────────────────
    // Returns user's registered passkeys (requires session)
    if (url.searchParams.get("action") === "passkey-list") {
      try {
        const user = await getAuthUser(request, env);
        if (!user) return new Response(JSON.stringify({error:"Not authenticated"}), {status:401,headers:corsJson});
        const { results } = await env.DB.prepare(
          "SELECT id, credential_id, device_name, created_at, last_used FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at DESC"
        ).bind(user.id).all();
        return new Response(JSON.stringify({ passkeys: results }), { headers: corsJson });
      } catch(e) {
        return new Response(JSON.stringify({error:e.message}), {status:500,headers:corsJson});
      }
    }

    // ── Passkey: POST ?action=passkey-delete ─────────────────────
    if (request.method === "POST" && url.searchParams.get("action") === "passkey-delete") {
      try {
        const user = await getAuthUser(request, env);
        if (!user) return new Response(JSON.stringify({error:"Not authenticated"}), {status:401,headers:corsJson});
        const { id: pkId } = await request.json();
        await env.DB.prepare("DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?").bind(pkId, user.id).run();
        return new Response(JSON.stringify({ ok: true }), { headers: corsJson });
      } catch(e) {
        return new Response(JSON.stringify({error:e.message}), {status:500,headers:corsJson});
      }
    }

    // ── Auth: POST /auth/logout ───────────────────────────────────
    if (request.method === "POST" && url.searchParams.get("action") === "auth-logout") {
      const sessionId = getSessionCookie(request);
      if (sessionId && env.DB) {
        await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run().catch(() => {});
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsJson, "Set-Cookie": sessionCookie("", 0) },
      });
    }

    // ── Auth gate: all routes below require a valid session ───────
    // Exception: requests carrying X-Snapshot-Secret bypass session auth
    // (admin tooling, cron callbacks, backfill scripts).
    const isAdminSecret = !!(env.SNAPSHOT_SECRET &&
      request.headers.get("X-Snapshot-Secret") === env.SNAPSHOT_SECRET);
    let currentUser = null;
    if (!isAdminSecret) {
      currentUser = await getAuthUser(request, env);
      if (!currentUser) {
        return new Response(JSON.stringify({ error: "Unauthorized", code: "NO_SESSION" }), {
          status: 401, headers: corsJson,
        });
      }
    }

    // ── Marketing (Meta ads) insights: ?action=marketing-insights&window=mtd|last_60d
    // Reads the meta_ad_insights table (populated via MCP backfill in Phase 1,
    // and by the worker→Meta API cron in Phase 2). Returns a combined topline
    // across all accounts, a per-account breakdown, and the campaign rows.
    // Account-wide data (not store-scoped); any authenticated user may read.
    if (url.searchParams.get("action") === "marketing-insights") {
      if (!env.DB) {
        return new Response(JSON.stringify({ error: "D1 not configured" }), { status: 500, headers: corsJson });
      }
      const window = (url.searchParams.get("window") || "mtd").toLowerCase();
      const ALLOWED_WINDOWS = ["7d", "14d", "30d", "90d", "mtd", "last_60d"];
      if (!ALLOWED_WINDOWS.includes(window)) {
        return new Response(JSON.stringify({ error: "window must be one of " + ALLOWED_WINDOWS.join(", ") }), { status: 400, headers: corsJson });
      }

      const { results: rows } = await env.DB.prepare(
        "SELECT * FROM meta_ad_insights WHERE window = ? ORDER BY level, spend DESC"
      ).bind(window).all();

      const accountRows = (rows || []).filter(r => r.level === "account");
      const campaignRows = (rows || []).filter(r => r.level === "campaign");

      // Combined topline across every account. Rate metrics (cpc/cpm/ctr/
      // frequency) are recomputed from summed base counts rather than averaged,
      // so they stay correct across accounts.
      const sum = (arr, k) => arr.reduce((t, r) => t + (Number(r[k]) || 0), 0);
      const spend = sum(accountRows, "spend");
      const impressions = sum(accountRows, "impressions");
      const reach = sum(accountRows, "reach");
      const clicks = sum(accountRows, "clicks");
      const linkClicks = sum(accountRows, "link_clicks");
      const purchases = accountRows.some(r => r.purchases != null) ? sum(accountRows, "purchases") : null;
      const purchaseValue = accountRows.some(r => r.purchase_value != null) ? sum(accountRows, "purchase_value") : null;
      const topline = {
        spend,
        impressions,
        reach,
        clicks,
        linkClicks,
        cpc: clicks ? spend / clicks : null,
        cpm: impressions ? (spend / impressions) * 1000 : null,
        ctr: impressions ? (clicks / impressions) * 100 : null,
        frequency: reach ? impressions / reach : null,
        purchases,
        purchaseValue,
        roas: purchaseValue != null && spend ? purchaseValue / spend : null,
        dateStart: accountRows[0]?.date_start || null,
        dateStop: accountRows[0]?.date_stop || null,
      };

      const byAccount = accountRows.map(r => ({
        accountId: r.account_id,
        accountName: r.account_name,
        spend: r.spend, impressions: r.impressions, reach: r.reach,
        clicks: r.clicks, linkClicks: r.link_clicks,
        cpc: r.cpc, cpm: r.cpm, ctr: r.ctr, frequency: r.frequency,
        purchases: r.purchases, purchaseValue: r.purchase_value, roas: r.roas,
      }));

      const campaigns = campaignRows.map(r => ({
        accountId: r.account_id,
        id: r.entity_id, name: r.entity_name, objective: r.objective,
        pageId: r.page_id || null,
        store: storeByPage(r.page_id) || campaignStore(r.entity_name),
        spend: r.spend, impressions: r.impressions, reach: r.reach,
        clicks: r.clicks, linkClicks: r.link_clicks,
        cpc: r.cpc, cpm: r.cpm, ctr: r.ctr,
        purchases: r.purchases, roas: r.roas,
      }));

      const fetchedAt = (rows || []).reduce((m, r) => (r.fetched_at > m ? r.fetched_at : m), "");

      return new Response(JSON.stringify({ window, fetchedAt, topline, byAccount, campaigns }), { headers: corsJson });
    }

    // ── Marketing refresh: pull live Meta insights → D1 (Phase 2). Admin or
    //    X-Snapshot-Secret. Also runs on the daily cron in scheduled().
    if (url.searchParams.get("action") === "marketing-refresh") {
      if (!isAdminSecret && !canAccessInventory(currentUser)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsJson });
      }
      const result = await fetchMetaInsights(env);
      return new Response(JSON.stringify(result), { status: result.error ? 400 : 200, headers: corsJson });
    }

    // ── Marketing Flow Calendar: ?action=flow-calendar ───────────────
    // The promotional pipeline (source of truth). Returns the full fiscal year:
    // `weeks` (marketing_flow, one row per retail week) plus `segments`
    // (flow_segments — the seasonal lifecycle / leadership / beyond-bargains
    // bands that span multiple weeks). The frontend renders both as a matrix.
    // Account-wide planning data (not store-scoped); any authenticated user
    // may read. Managers consume it; admins will edit it (Phase 2).
    if (url.searchParams.get("action") === "flow-calendar") {
      if (!env.DB) {
        return new Response(JSON.stringify({ error: "D1 not configured" }), { status: 500, headers: corsJson });
      }
      const fy = url.searchParams.get("fy") || "F26";
      const { results: weeks } = await env.DB.prepare(
        "SELECT * FROM marketing_flow WHERE fiscal_year = ? ORDER BY retail_week"
      ).bind(fy).all();
      let segments = [];
      try {
        const seg = await env.DB.prepare(
          "SELECT * FROM flow_segments WHERE fiscal_year = ? ORDER BY sort_order, start_week"
        ).bind(fy).all();
        segments = seg.results || [];
      } catch (e) { /* table may not exist yet on prod — degrade gracefully */ }
      return new Response(JSON.stringify({ fiscalYear: fy, weeks: weeks || [], segments }), { headers: corsJson });
    }

    // ── User management: list-users ──────────────────────────────────
    if (url.searchParams.get("action") === "list-users") {
      if (!canAccessInventory(currentUser)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsJson });
      }
      const { results } = await env.DB.prepare(
        "SELECT id, email, role, stores, status, created_at, last_login FROM users ORDER BY created_at DESC"
      ).all();
      return new Response(JSON.stringify({ ok: true, users: results || [] }), { headers: corsJson });
    }

    // ── User management: invite-user ─────────────────────────────────
    if (request.method === "POST" && url.searchParams.get("action") === "invite-user") {
      if (!canAccessInventory(currentUser)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsJson });
      }
      try {
        const { email, role, stores } = await request.json();
        const validRoles = currentUser.role === 'superuser'
          ? ['admin', 'district_manager', 'manager']
          : ['district_manager', 'manager'];
        if (!validRoles.includes(role)) {
          return new Response(JSON.stringify({ error: "Invalid role" }), { status: 400, headers: corsJson });
        }
        const normalized = email.trim().toLowerCase();
        const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(normalized).first();
        if (existing) {
          return new Response(JSON.stringify({ error: "A user with that email already exists" }), { status: 409, headers: corsJson });
        }
        const id = 'usr_' + randomHex(8);
        const storesJson = stores && stores.length ? JSON.stringify(stores) : null;
        await env.DB.prepare(
          "INSERT INTO users (id, email, role, stores, status, created_at) VALUES (?, ?, ?, ?, 'active', datetime('now'))"
        ).bind(id, normalized, role, storesJson).run();
        const token = randomHex(32);
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await env.DB.prepare("INSERT INTO magic_links (token, email, expires_at) VALUES (?, ?, ?)")
          .bind(token, normalized, expires).run();
        await sendInviteEmail(normalized, token, env);
        return new Response(JSON.stringify({ ok: true }), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

    // ── User management: resend-invite ───────────────────────────────
    if (request.method === "POST" && url.searchParams.get("action") === "resend-invite") {
      if (!canAccessInventory(currentUser)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsJson });
      }
      try {
        const { email } = await request.json();
        const normalized = email.trim().toLowerCase();
        const user = await env.DB.prepare("SELECT id FROM users WHERE email = ? AND status = 'active'").bind(normalized).first();
        if (!user) return new Response(JSON.stringify({ error: "User not found" }), { status: 404, headers: corsJson });
        const token = randomHex(32);
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await env.DB.prepare("INSERT INTO magic_links (token, email, expires_at) VALUES (?, ?, ?)")
          .bind(token, normalized, expires).run();
        await sendInviteEmail(normalized, token, env);
        return new Response(JSON.stringify({ ok: true }), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

    // ── User management: update-user ─────────────────────────────────
    if (request.method === "POST" && url.searchParams.get("action") === "update-user") {
      if (!canAccessInventory(currentUser)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsJson });
      }
      try {
        const { id, role, stores, status } = await request.json();
        const parts = [], values = [];
        if (role !== undefined) { parts.push('role = ?'); values.push(role); }
        if (stores !== undefined) { parts.push('stores = ?'); values.push(stores && stores.length ? JSON.stringify(stores) : null); }
        if (status !== undefined) { parts.push('status = ?'); values.push(status); }
        if (!parts.length) return new Response(JSON.stringify({ error: "Nothing to update" }), { status: 400, headers: corsJson });
        values.push(id);
        await env.DB.prepare(`UPDATE users SET ${parts.join(', ')} WHERE id = ?`).bind(...values).run();
        return new Response(JSON.stringify({ ok: true }), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

    // ── User management: delete-user ─────────────────────────────────
    if (request.method === "POST" && url.searchParams.get("action") === "delete-user") {
      if (currentUser.role !== 'superuser') {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsJson });
      }
      try {
        const { id } = await request.json();
        if (id === currentUser.id) {
          return new Response(JSON.stringify({ error: "Cannot delete your own account" }), { status: 400, headers: corsJson });
        }
        await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
        return new Response(JSON.stringify({ ok: true }), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

    // ── History endpoint: ?history=true&store=BL1&from=2026-03-25&to=2026-04-01
    if (url.searchParams.get("history") === "true") {
      const store = url.searchParams.get("store");
      if (!store) {
        return new Response(JSON.stringify({ error: "Please specify a store" }), {
          status: 400, headers: corsHeaders,
        });
      }
      if (!canAccessStore(currentUser, store)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsJson });
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
      if (!env.DB) {
        return new Response(JSON.stringify({ error: "D1 not configured" }), { status: 500, headers: corsJson });
      }
      const store = (url.searchParams.get("store") || "").toUpperCase();
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (!store || !from || !to) {
        return new Response(JSON.stringify({ error: "Missing store, from, or to params" }), { status: 400, headers: corsJson });
      }
      if (!canAccessStore(currentUser, store)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsJson });
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
          avgASP: row.avg_asp ?? null,
          snapshotTime: row.snapshot_time,
          budget: row.budget, laborPct: row.labor_pct,
          auction: row.auction, week: row.week,
        };
      }
      return new Response(JSON.stringify(out), { headers: corsJson });
    }

    // ── Debug endpoint: explain why aggregateOrders.totalNet diverges from
    // aggregateItemSales.grandTotal. Returns side-by-side totals + per-order
    // diffs + refund/credit dedup check.
    // ?action=debug-revenue-mismatch&store=BL2&date=2026-05-13
    if (url.searchParams.get("action") === "debug-revenue-mismatch") {
      const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
      const unauth = requireAdminSecret(request, env, corsJson);
      if (unauth) return unauth;

      const store = (url.searchParams.get("store") || "").toUpperCase();
      const dateStr = url.searchParams.get("date") || getETToday().dateStr;
      if (!store) {
        return new Response(JSON.stringify({ error: "Missing store param" }), { status: 400, headers: corsJson });
      }
      const startOfDay = getStartOfDayET(dateStr);
      const nextDay = new Date(dateStr + 'T12:00:00Z');
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      const untilTs = getStartOfDayET(nextDay.toISOString().slice(0, 10));

      // Fetch everything aggregateItemSales would see
      const [elements, refundElements, manualRefundElements, itemCatMap, overrides, itemCosts] = await Promise.all([
        fetchItemOrders(store, env, startOfDay, untilTs),
        fetchRefundElements(store, env, startOfDay, untilTs),
        fetchManualRefunds(store, env, startOfDay, untilTs),
        fetchItemCategoryMap(store, env),
        fetchItemOverrides(env),
        fetchItemCosts(env),
      ]);
      const extraOrders = await fetchCrossDayOrdersForRefunds(store, env, elements, refundElements);

      // ── Path A: aggregateOrders ─────────────────────────
      const aggOrders = aggregateOrders(elements, startOfDay);
      const refundsTotalCents = await fetchRefundsTotal(store, env, startOfDay, untilTs, null);
      const aggOrdersTotalPostRefunds = aggOrders.total - (refundsTotalCents / 100);

      // ── Path B: aggregateItemSales ──────────────────────
      const aggItems = aggregateItemSales(
        elements, itemCatMap, store, dateStr, overrides, itemCosts,
        refundElements, extraOrders, manualRefundElements
      );
      const itemGrandTotal = (aggItems.categories || []).reduce((s, c) => s + (c.netSales || 0), 0);

      // ── Per-order diff: payment-based net vs line-item net ──────
      const perOrderDiffs = [];
      for (const order of (elements || [])) {
        if (order.total == null || order.total === 0) continue;
        if (order.state !== "locked") continue;

        const taxCents = (order.payments?.elements || []).reduce((s, p) => s + (p.taxAmount || 0), 0);
        const pmtSumCents = (order.payments?.elements || []).reduce((s, p) => s + (p.amount || 0), 0);
        const grossOrderCents = pmtSumCents > 0 ? pmtSumCents : order.total;
        const orderNetCents = grossOrderCents - taxCents;

        // Compute line item net the way aggregateItemSales does
        let liGrossCents = 0, liDiscCents = 0, liRefundCents = 0;
        const lineItems = order.lineItems?.elements || [];
        // First pass: line-level discounts + post-line subtotal
        let subAfterLineDisc = 0;
        const liDiscCache = new Map();
        for (const li of lineItems) {
          const qty = li.unitQty != null ? li.unitQty / 1000 : 1;
          const grossC = Math.abs((li.price || 0) * qty);
          let d = 0;
          for (const dd of (li.discounts?.elements || [])) {
            if (dd.amount != null && dd.amount !== 0) d += Math.abs(dd.amount);
            else if (dd.percentage) d += Math.round(grossC * Number(dd.percentage) / 100);
          }
          liDiscCache.set(li, d);
          if ((li.price || 0) >= 0) subAfterLineDisc += (grossC - d);
        }
        let orderDiscCents = 0;
        for (const dd of (order.discounts?.elements || [])) {
          if (dd.amount != null && dd.amount !== 0) orderDiscCents += Math.abs(dd.amount);
          else if (dd.percentage && subAfterLineDisc > 0) orderDiscCents += Math.round(subAfterLineDisc * Number(dd.percentage) / 100);
        }
        // Second pass: total per-line net contribution
        for (const li of lineItems) {
          const qty = li.unitQty != null ? li.unitQty / 1000 : 1;
          const priceC = (li.price || 0) * qty;
          const grossC = Math.abs(priceC);
          let d = liDiscCache.get(li) || 0;
          if (priceC >= 0 && orderDiscCents > 0 && subAfterLineDisc > 0) {
            const lineNet = grossC - d;
            if (lineNet > 0) d += Math.round(orderDiscCents * lineNet / subAfterLineDisc);
          }
          if (priceC < 0) liRefundCents += grossC;
          else { liGrossCents += grossC; liDiscCents += d; }
        }
        const itemNetCents = liGrossCents - liDiscCents - liRefundCents;
        const diffCents = orderNetCents - itemNetCents;
        if (Math.abs(diffCents) > 1) {
          perOrderDiffs.push({
            orderId: order.id,
            orderTotal: order.total / 100,
            pmtSum: pmtSumCents / 100,
            taxCents: taxCents / 100,
            orderNet: orderNetCents / 100,
            liGross: liGrossCents / 100,
            liDisc: liDiscCents / 100,
            liRefund: liRefundCents / 100,
            itemNet: itemNetCents / 100,
            diff: diffCents / 100,
            lineItemCount: lineItems.length,
            hasServiceCharge: !!order.serviceCharge,
            sampleItems: lineItems.slice(0, 3).map(li => ({ name: li.name, price: (li.price || 0) / 100, qty: li.unitQty != null ? li.unitQty / 1000 : 1 })),
          });
        }
      }
      perOrderDiffs.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

      // ── Dedup check: any refund.id matches a credit.id? Or same amount+createdTime? ──
      const refundIds = new Set((refundElements || []).map(r => r.id));
      const creditIds = new Set((manualRefundElements || []).map(r => r.id));
      const sharedIds = [...refundIds].filter(id => creditIds.has(id));
      // Amount+time match (within 5min)
      const refundFingerprints = (refundElements || []).map(r => ({ id: r.id, amount: r.amount, t: r.createdTime }));
      const creditFingerprints = (manualRefundElements || []).map(r => ({ id: r.id, amount: r.amount, t: r.createdTime }));
      const possibleDupes = [];
      for (const r of refundFingerprints) {
        for (const c of creditFingerprints) {
          if (r.amount === c.amount && Math.abs(r.t - c.t) < 300000) {
            possibleDupes.push({ refundId: r.id, creditId: c.id, amount: r.amount, secondsApart: Math.abs(r.t - c.t) / 1000 });
          }
        }
      }

      return new Response(JSON.stringify({
        store, dateStr,
        summary: {
          aggregateOrders_totalNet_preRefund: aggOrders.total,
          aggregateOrders_totalNet_postRefund: +aggOrdersTotalPostRefunds.toFixed(2),
          aggregateItemSales_grandTotal: +itemGrandTotal.toFixed(2),
          refundsCents_subtracted: refundsTotalCents / 100,
          gap_postRefund: +(aggOrdersTotalPostRefunds - itemGrandTotal).toFixed(2),
          // Per category breakdown for sanity-check
          categoryTotals: (aggItems.categories || []).map(c => ({ category: c.category, qty: c.qty, gross: c.gross, discounts: c.discounts, refunds: c.refunds, netSales: c.netSales })),
        },
        refundDedupCheck: {
          refundCount: refundElements?.length || 0,
          creditCount: manualRefundElements?.length || 0,
          sharedIdsCount: sharedIds.length,
          sharedIdsSample: sharedIds.slice(0, 5),
          possibleDuplicates_amountTimeMatch: possibleDupes,
        },
        ordersWithRevenueDiff: {
          count: perOrderDiffs.length,
          totalDiff: +(perOrderDiffs.reduce((s, o) => s + o.diff, 0)).toFixed(2),
          top10: perOrderDiffs.slice(0, 10),
        },
      }, null, 2), { headers: corsJson });
    }

    // ── Debug endpoint: show per-order residuals feeding "Other / Non-Item".
    // ?action=debug-residuals&store=BL1&date=2026-05-11
    // For each order: compute orderNet (total - tax) vs sum of line-item nets.
    // Returns the top N orders by absolute residual + breakdown of why.
    if (url.searchParams.get("action") === "debug-residuals") {
      const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
      const unauth = requireAdminSecret(request, env, corsJson);
      if (unauth) return unauth;

      const store = (url.searchParams.get("store") || "").toUpperCase();
      const dateStr = url.searchParams.get("date") || getETToday().dateStr;
      const limit = parseInt(url.searchParams.get("limit") || "15", 10);
      if (!store) {
        return new Response(JSON.stringify({ error: "Missing store param" }), { status: 400, headers: corsJson });
      }
      const startOfDay = getStartOfDayET(dateStr);
      const nextDay = new Date(dateStr + 'T12:00:00Z');
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      const untilTs = getStartOfDayET(nextDay.toISOString().slice(0, 10));

      const elements = await fetchItemOrders(store, env, startOfDay, untilTs);
      let totalResidualCents = 0;
      let positiveResidualCents = 0;
      let negativeResidualCents = 0;
      const perOrder = [];

      for (const order of (elements || [])) {
        if (order.total == null || order.total === 0) continue;
        if (order.state !== "locked") continue;

        const taxCents = (order.payments?.elements || []).reduce((s, p) => s + (p.taxAmount || 0), 0);
        const pmtSumCents = (order.payments?.elements || []).reduce((s, p) => s + (p.amount || 0), 0);
        const grossOrderCents = pmtSumCents > 0 ? pmtSumCents : order.total;
        const orderNetCents = grossOrderCents - taxCents;

        const lineItems = order.lineItems?.elements || [];
        let liGrossSum = 0;
        let liDiscSum = 0;
        let liRefundSum = 0;
        let lineDetail = [];
        for (const li of lineItems) {
          const qty = li.unitQty != null ? li.unitQty / 1000 : 1;
          const priceCents = (li.price || 0) * qty;
          const grossCents = Math.abs(priceCents);
          let lineDiscCents = 0;
          for (const d of (li.discounts?.elements || [])) {
            if (d.amount != null && d.amount !== 0) lineDiscCents += Math.abs(d.amount);
            else if (d.percentage) lineDiscCents += Math.round(grossCents * Number(d.percentage) / 100);
          }
          if (priceCents < 0) {
            liRefundSum += grossCents;
          } else {
            liGrossSum += grossCents;
            liDiscSum += lineDiscCents;
          }
          lineDetail.push({
            name: li.name, priceCents, qty, lineDiscCents,
          });
        }
        // Order-level discount
        let orderDiscCents = 0;
        for (const d of (order.discounts?.elements || [])) {
          if (d.amount != null && d.amount !== 0) orderDiscCents += Math.abs(d.amount);
          else if (d.percentage) orderDiscCents += Math.round((liGrossSum - liDiscSum) * Number(d.percentage) / 100);
        }
        const liNetSum = liGrossSum - liDiscSum - orderDiscCents - liRefundSum;
        const residualCents = Math.round(orderNetCents - liNetSum);
        totalResidualCents += residualCents;
        if (residualCents > 0) positiveResidualCents += residualCents;
        else if (residualCents < 0) negativeResidualCents += residualCents;

        if (residualCents !== 0) {
          perOrder.push({
            orderId: order.id,
            orderTotal: order.total / 100,
            taxCents,
            orderNet: orderNetCents / 100,
            lineItemCount: lineItems.length,
            liGross: liGrossSum / 100,
            liDisc: liDiscSum / 100,
            orderDisc: orderDiscCents / 100,
            liRefund: liRefundSum / 100,
            liNetSum: liNetSum / 100,
            residual: residualCents / 100,
            lineItems: lineDetail.slice(0, 6).map(l => ({
              name: l.name, price: l.priceCents / 100, qty: l.qty, disc: l.lineDiscCents / 100,
            })),
            hasOrderServiceCharge: !!order.serviceCharge,
            hasCredits: !!(order.credits?.elements?.length),
            modifiedTime: order.modifiedTime,
          });
        }
      }
      perOrder.sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual));

      return new Response(JSON.stringify({
        store, dateStr,
        ordersFetched: elements?.length || 0,
        ordersWithResidual: perOrder.length,
        totalResidual: `$${(totalResidualCents / 100).toFixed(2)}`,
        positiveResidual: `$${(positiveResidualCents / 100).toFixed(2)}`,
        negativeResidual: `$${(negativeResidualCents / 100).toFixed(2)}`,
        top: perOrder.slice(0, limit),
      }, null, 2), { headers: corsJson });
    }

    // ── Debug endpoint: show raw response from Clover's manual_refunds endpoint.
    // Tries multiple URL variants to find the correct path. Use to diagnose
    // why fetchManualRefunds returns empty when manual refunds clearly exist
    // on Clover's Sales Summary.
    // ?action=debug-manual-refunds&store=BL14&date=2026-05-12
    if (url.searchParams.get("action") === "debug-manual-refunds") {
      const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
      const unauth = requireAdminSecret(request, env, corsJson);
      if (unauth) return unauth;

      const store = (url.searchParams.get("store") || "").toUpperCase();
      const dateStr = url.searchParams.get("date") || getETToday().dateStr;
      const merchantId = env[`${store}_MERCHANT_ID`];
      const apiToken = env[`${store}_API_TOKEN`];
      if (!merchantId || !apiToken) {
        return new Response(JSON.stringify({ error: "Store keys not found" }), { status: 404, headers: corsJson });
      }
      const startOfDay = getStartOfDayET(dateStr);
      const nextDay = new Date(dateStr + 'T12:00:00Z');
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      const untilTs = getStartOfDayET(nextDay.toISOString().slice(0, 10));

      const headers = { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" };
      const variants = [
        // Try the specific manual refund ID in various endpoints
        `https://api.clover.com/v3/merchants/${merchantId}/refunds/F88E35ZXJYNCP`,
        `https://api.clover.com/v3/merchants/${merchantId}/credit_refunds/F88E35ZXJYNCP`,
        `https://api.clover.com/v3/merchants/${merchantId}/credits/F88E35ZXJYNCP`,
        `https://api.clover.com/v3/merchants/${merchantId}/orders/F88E35ZXJYNCP`,
        // List endpoints to find manual refund records
        `https://api.clover.com/v3/merchants/${merchantId}/credit_refunds?limit=10`,
        `https://api.clover.com/v3/merchants/${merchantId}/credits?limit=10`,
        // Refunds without date filter to see if manual ones show up at all
        `https://api.clover.com/v3/merchants/${merchantId}/refunds?limit=20`,
        // POST to manual_refunds (some Clover endpoints support GET via POST)
        `https://api.clover.com/v3/merchants/${merchantId}/manual_refunds`,
      ];
      const results = [];
      for (const u of variants) {
        try {
          const resp = await fetch(u, { headers });
          const text = await resp.text();
          let parsed = null;
          try { parsed = JSON.parse(text); } catch {}

          // For payments endpoint, find any with negative amounts or refund-like properties
          let negativePayments = null;
          let refundPayments = null;
          if (parsed?.elements && Array.isArray(parsed.elements)) {
            negativePayments = parsed.elements.filter(e => (e.amount || 0) < 0).slice(0, 3);
            refundPayments = parsed.elements.filter(e =>
              e.tender?.label?.toLowerCase().includes('refund') ||
              e.tender?.labelKey?.toLowerCase().includes('refund') ||
              e.tender?.label?.toLowerCase().includes('manual')
            ).slice(0, 3);
          }
          results.push({
            url: u,
            status: resp.status,
            ok: resp.ok,
            totalElements: parsed?.elements?.length ?? null,
            firstElement: parsed?.elements?.[0] ?? (parsed && !parsed.elements ? parsed : null),
            negativeAmountCount: negativePayments?.length ?? null,
            negativeAmountSample: negativePayments,
            refundLikeCount: refundPayments?.length ?? null,
            refundLikeSample: refundPayments,
            errorBody: !resp.ok ? text.slice(0, 500) : null,
          });
        } catch (e) {
          results.push({ url: u, error: e.message });
        }
      }
      return new Response(JSON.stringify({ store, dateStr, results }, null, 2), { headers: corsJson });
    }

    // ── Admin: force-refresh the item category map cache for a store.
    // ?action=refresh-item-cats&store=BL1   (or store=all)
    // Deletes the cached KV map and refetches from Clover.
    if (url.searchParams.get("action") === "refresh-item-cats") {
      const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
      const unauth = requireAdminSecret(request, env, corsJson);
      if (unauth) return unauth;

      const storeParam = (url.searchParams.get("store") || "").toUpperCase();
      if (!storeParam) {
        return new Response(JSON.stringify({ error: "Missing store param" }), { status: 400, headers: corsJson });
      }
      const targets = storeParam === "ALL" ? ALL_STORES : [storeParam];
      const results = {};

      for (const store of targets) {
        try {
          if (env.SALES_SNAPSHOTS) {
            await env.SALES_SNAPSHOTS.delete(`item-cats:${store.toLowerCase()}`);
          }
          const map = await fetchItemCategoryMap(store, env);
          results[store] = { ok: true, size: Object.keys(map || {}).length };
        } catch (e) {
          results[store] = { ok: false, error: e.message };
        }
      }
      return new Response(JSON.stringify({ ok: true, results }, null, 2), { headers: corsJson });
    }

    // ── Debug endpoint: inspect raw refund payload structure from Clover.
    // Use to diagnose cross-day refund attribution failures — shows whether
    // expand=lineItem,lineItem.item is actually returning the line-item name
    // and catalog item.id we need for category resolution.
    // ?action=debug-refunds&store=BL1&date=2026-05-11
    if (url.searchParams.get("action") === "debug-refunds") {
      const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
      const unauth = requireAdminSecret(request, env, corsJson);
      if (unauth) return unauth;

      const store = (url.searchParams.get("store") || "").toUpperCase();
      const dateStr = url.searchParams.get("date") || getETToday().dateStr;
      if (!store) {
        return new Response(JSON.stringify({ error: "Missing store param" }), { status: 400, headers: corsJson });
      }
      const startOfDay = getStartOfDayET(dateStr);
      const nextDay = new Date(dateStr + 'T12:00:00Z');
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      const untilTs = getStartOfDayET(nextDay.toISOString().slice(0, 10));

      const [elements, refundElements] = await Promise.all([
        fetchItemOrders(store, env, startOfDay, untilTs),
        fetchRefundElements(store, env, startOfDay, untilTs),
      ]);
      const itemCatMap = await fetchItemCategoryMap(store, env);

      // Build the set of orderIds we have line items for (same logic the
      // main loop uses) so we can tell which refunds will resolve via the
      // order-ID path vs fall back to cross-day Refund L2.
      const fetchedOrderIds = new Set();
      for (const o of (elements || [])) {
        if (o.id && o.total != null && o.total !== 0 && o.state === "locked") {
          fetchedOrderIds.add(o.id);
        }
      }

      const summary = (refundElements || []).map(r => {
        const orderId = r.orderRef?.id || r.payment?.order?.id || null;
        return {
          id: r.id,
          amount: r.amount,
          taxAmount: r.taxAmount,
          netCents: (r.amount || 0) - (r.taxAmount || 0),
          orderId,
          orderInTodaysFetch: orderId ? fetchedOrderIds.has(orderId) : false,
          willAttribute: orderId && fetchedOrderIds.has(orderId) ? "BY-ORDER (proportional across line items)" : "CROSS-DAY (generic Refund L2)",
        };
      });

      const sameDayCount = summary.filter(s => s.orderInTodaysFetch).length;
      const totalRefundsCents = summary.reduce((s, x) => s + x.netCents, 0);
      const sameDayCents = summary.filter(s => s.orderInTodaysFetch).reduce((s, x) => s + x.netCents, 0);

      // Phase 2F: also confirm cross-day orders can be fetched + attributed.
      const extraOrders = await fetchCrossDayOrdersForRefunds(store, env, elements, refundElements);
      const crossDayFetched = new Set(extraOrders.map(o => o?.id).filter(Boolean));
      for (const s of summary) {
        if (!s.orderInTodaysFetch && s.orderId && crossDayFetched.has(s.orderId)) {
          s.willAttribute = "CROSS-DAY-FETCHED (proportional across original order's line items)";
          s.crossDayFetched = true;
        } else if (!s.orderInTodaysFetch) {
          s.crossDayFetched = false;
          s.willAttribute = "UNRESOLVABLE (original order not fetchable, falls to generic Refund L2)";
        }
      }
      const crossDayFetchedCount = summary.filter(s => s.crossDayFetched).length;
      const crossDayFetchedCents = summary.filter(s => s.crossDayFetched).reduce((s, x) => s + x.netCents, 0);
      const unresolvableCents = totalRefundsCents - sameDayCents - crossDayFetchedCents;

      return new Response(JSON.stringify({
        store, dateStr,
        refundCount: refundElements?.length || 0,
        ordersFetched: elements?.length || 0,
        itemCatMapSize: Object.keys(itemCatMap || {}).length,
        crossDayOrdersFetched: extraOrders.length,
        refundsTotal: `$${(totalRefundsCents / 100).toFixed(2)}`,
        refundsSameDay: `$${(sameDayCents / 100).toFixed(2)} (${sameDayCount}/${summary.length})`,
        refundsCrossDayFetched: `$${(crossDayFetchedCents / 100).toFixed(2)} (${crossDayFetchedCount}/${summary.length})`,
        refundsUnresolvable: `$${(unresolvableCents / 100).toFixed(2)} (${summary.length - sameDayCount - crossDayFetchedCount}/${summary.length})`,
        sample: summary.slice(0, 20),
        rawSample: refundElements?.[0] || null,
      }, null, 2), { headers: corsJson });
    }

    // ── Manual snapshot endpoint: ?action=snapshot&store=BL1[&date=2026-04-26]
    // store=all snapshots every store. date defaults to today (ET, not UTC).
    if (url.searchParams.get("action") === "snapshot") {
      const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
      const unauth = requireAdminSecret(request, env, corsJson);
      if (unauth) return unauth;

      const storeParam = (url.searchParams.get("store") || "").toUpperCase();
      if (!storeParam) {
        return new Response(JSON.stringify({ error: "Missing store param (use store=BL1 or store=all)" }), {
          status: 400, headers: corsJson,
        });
      }
      const stores = storeParam === "ALL" ? ALL_STORES : [storeParam];

      const { dateStr: todayStr } = getETToday();
      const dateStr = url.searchParams.get("date") || todayStr;

      // Use ET day boundaries (was UTC — caused day-shift bug for early-AM snapshots).
      const startOfDay = getStartOfDayET(dateStr);
      let untilTs = null;
      if (dateStr !== todayStr) {
        const nextDay = new Date(dateStr + 'T12:00:00Z');
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        untilTs = getStartOfDayET(nextDay.toISOString().slice(0, 10));
      }

      // Phase 2D: fetch overrides + costs ONCE for the category-based
      // bin/retail override computation (shared across all stores).
      const [overrides, itemCosts] = await Promise.all([
        fetchItemOverrides(env),
        fetchItemCosts(env),
      ]);

      // Run all stores in parallel — each store is independent and the
      // subrequest budget is per-store-per-day (~30), so 6 in parallel
      // stays well under Cloudflare's 1,000-per-invocation cap while
      // dropping wall-clock from ~12s to ~2s per date.
      const settled = await Promise.allSettled(
        stores.map(async (store) => {
          // Compute category-based bin/retail override (best-effort — falls
          // back to name-based aggregateOrders split on failure). Also writes
          // the full item-sales snapshot to KV so the Item Sales tab reflects
          // the latest aggregateItemSales output (refund attribution etc.).
          let binRetailOverride = null;
          try {
            const [elements, refundElements, manualRefundElements] = await Promise.all([
              fetchItemOrders(store, env, startOfDay, untilTs),
              fetchRefundElements(store, env, startOfDay, untilTs),
              fetchManualRefunds(store, env, startOfDay, untilTs),
            ]);
            if (elements && elements.length > 0) {
              const itemCatMap = await fetchItemCategoryMap(store, env);
              // Phase 2F: fetch original orders for cross-day refunds so they
              // attribute by category instead of falling to the Refund L2 bucket.
              const extraOrders = await fetchCrossDayOrdersForRefunds(store, env, elements, refundElements);
              const itemAgg = aggregateItemSales(elements, itemCatMap, store, dateStr, overrides, itemCosts, refundElements, extraOrders, manualRefundElements);
              let binNet = 0, retailNet = 0;
              for (const c of (itemAgg.categories || [])) {
                if (c.category === "Bin Products") binNet += c.netSales;
                else retailNet += c.netSales;
              }
              // Phase 3: include grand total so D1.total = sum of categories,
              // matching what the user sees in the Item Sales breakdown.
              binRetailOverride = {
                bin: binNet,
                retail: retailNet,
                total: itemAgg.totals?.netSales,
              };
              // Persist item snapshot to KV — this is what the Item Sales tab reads.
              // Previously the admin re-snapshot path skipped this write and only
              // updated D1, so item-tab refunds never reflected admin re-runs.
              try {
                await saveItemSalesSnapshot(env, store, dateStr, itemAgg);
              } catch (saveErr) {
                console.warn(`Admin item-snapshot save failed for ${store}: ${saveErr.message}`);
              }
            }
          } catch (e) {
            console.warn(`Admin snapshot override prep failed for ${store}: ${e.message}`);
          }
          return fetchAggregateAndSnapshot(store, env, startOfDay, dateStr, untilTs, binRetailOverride);
        })
      );
      const results = {};
      settled.forEach((r, i) => {
        const store = stores[i];
        if (r.status === "fulfilled") {
          const data = r.value;
          results[store] = data
            ? { ok: true, total: data.total, refundsSubtracted: data.refundsSubtracted ?? 0 }
            : { error: "no credentials" };
        } else {
          results[store] = { error: r.reason?.message || String(r.reason) };
        }
      });
      return new Response(JSON.stringify({ ok: true, date: dateStr, results }), {
        headers: corsJson,
      });
    }

    // ── Backfill endpoint: ?action=backfill (imports Sheets + KV → D1)
    if (url.searchParams.get("action") === "backfill") {
      const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
      const unauth = requireAdminSecret(request, env, corsJson);
      if (unauth) return unauth;
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
                  order_count, avg_cart, avg_items, avg_txn_sec, avg_asp, snapshot_time)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(store, date) DO UPDATE SET
                   -- Manual-override rows are immutable: keep all existing values.
                   -- The CASE wrappers below short-circuit when is_manual_override=1.
                   -- Sheet-authoritative columns: Sheet always wins (humans enter these)
                   week=CASE WHEN is_manual_override=1 THEN week ELSE excluded.week END,
                   budget=CASE WHEN is_manual_override=1 THEN budget ELSE excluded.budget END,
                   -- auction is now owned by the Drive auction feed (?action=ingest):
                   -- existing wins, so the Sheet only seeds it when the feed hasn't yet.
                   auction=CASE WHEN is_manual_override=1 THEN auction ELSE COALESCE(auction, excluded.auction) END,
                   labor_pct=CASE WHEN is_manual_override=1 THEN labor_pct ELSE COALESCE(excluded.labor_pct, labor_pct) END,
                   -- Phase 2C: Cron-authoritative columns. Existing wins; Sheet only fills NULLs.
                   total=CASE WHEN is_manual_override=1 THEN total ELSE COALESCE(total, excluded.total) END,
                   retail=CASE WHEN is_manual_override=1 THEN retail ELSE COALESCE(retail, excluded.retail) END,
                   bin=CASE WHEN is_manual_override=1 THEN bin ELSE COALESCE(bin, excluded.bin) END,
                   order_count=CASE WHEN is_manual_override=1 THEN order_count ELSE COALESCE(order_count, excluded.order_count) END,
                   avg_cart=CASE WHEN is_manual_override=1 THEN avg_cart ELSE COALESCE(avg_cart, excluded.avg_cart) END,
                   avg_items=CASE WHEN is_manual_override=1 THEN avg_items ELSE COALESCE(avg_items, excluded.avg_items) END,
                   avg_txn_sec=CASE WHEN is_manual_override=1 THEN avg_txn_sec ELSE COALESCE(avg_txn_sec, excluded.avg_txn_sec) END,
                   avg_asp=CASE WHEN is_manual_override=1 THEN avg_asp ELSE COALESCE(avg_asp, excluded.avg_asp) END,
                   snapshot_time=CASE WHEN is_manual_override=1 THEN snapshot_time ELSE COALESCE(snapshot_time, excluded.snapshot_time) END`
              ).bind(
                storeCode, dateStr, week, bTotal,
                kvData?.total || aTotal || null, kvData?.retail || aRetail || null, kvData?.bin || aBins || null,
                aAuction || null, aLabor || null,
                kvData?.orderCount ?? null, kvData?.avgCart ?? null, kvData?.avgItems ?? null,
                kvData?.avgTxnSec != null ? Math.round(kvData.avgTxnSec) : null,
                kvData?.avgASP != null ? Math.round(kvData.avgASP * 100) / 100 : null,
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

    // ── Ingest: generic channel-sales sink (auction today; eon, labor next).
    //    POST /?action=ingest   { channel, source_file?, rows: [{store, date, total?, count?, meta?}] }
    //    Header: X-Snapshot-Secret. Feeders (Apps Script for Drive drops, worker
    //    crons for APIs) all normalize to this shape and POST here. Idempotent:
    //    UNIQUE(channel, store, date) upserts, so re-sent files never double-count.
    if (request.method === "POST" && url.searchParams.get("action") === "ingest") {
      const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
      const unauth = requireAdminSecret(request, env, corsJson);
      if (unauth) return unauth;

      let body;
      try { body = await request.json(); }
      catch { return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: corsJson }); }

      const channel = (body.channel || "").toString().trim().toLowerCase();
      const rows = Array.isArray(body.rows) ? body.rows : null;
      const sourceFile = body.source_file ? body.source_file.toString() : null;
      if (!channel) return new Response(JSON.stringify({ error: "Missing channel" }), { status: 400, headers: corsJson });
      if (!rows)    return new Response(JSON.stringify({ error: "Missing rows[]" }), { status: 400, headers: corsJson });

      const ingestedAt = new Date().toISOString();
      const stmt = env.DB.prepare(
        `INSERT INTO channel_sales (channel, store, date, total, count, meta, source_file, ingested_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(channel, store, date) DO UPDATE SET
           total       = excluded.total,
           count       = excluded.count,
           meta        = excluded.meta,
           source_file = excluded.source_file,
           ingested_at = excluded.ingested_at`
      );

      const batch = [];
      const errors = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] || {};
        const store = (r.store || "").toString().trim().toUpperCase();
        const date = (r.date || "").toString().trim();
        if (!store || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          errors.push({ i, store, date, reason: "missing/invalid store or date" });
          continue;
        }
        const total = (r.total == null || r.total === "") ? null : roundCents(Number(r.total));
        const count = (r.count == null || r.count === "") ? null : Math.trunc(Number(r.count));
        const meta  = (r.meta == null) ? null : JSON.stringify(r.meta);
        if (total != null && !Number.isFinite(total)) { errors.push({ i, store, date, reason: "non-numeric total" }); continue; }
        batch.push(stmt.bind(channel, store, date, total, count, meta, sourceFile, ingestedAt));
      }

      if (batch.length) await env.DB.batch(batch);

      // Projection: the dashboard reads daily_sales.auction (already folded into
      // each store's total + the violet "Auction" breakdown). Project the auction
      // channel's daily $ into that column so the UI lights up with no frontend
      // change. Feed-authoritative (overwrites), but never touches manual-override
      // rows. Other channels (eon/labor) get their own projection when added.
      let projected = 0;
      if (channel === "auction" && batch.length) {
        const proj = env.DB.prepare(
          `INSERT INTO daily_sales (store, date, auction) VALUES (?, ?, ?)
           ON CONFLICT(store, date) DO UPDATE SET
             auction = CASE WHEN is_manual_override = 1 THEN auction ELSE excluded.auction END`
        );
        const projBatch = [];
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i] || {};
          const store = (r.store || "").toString().trim().toUpperCase();
          const date = (r.date || "").toString().trim();
          if (!store || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
          if (r.total == null || r.total === "") continue;
          const total = roundCents(Number(r.total));
          if (!Number.isFinite(total)) continue;
          projBatch.push(proj.bind(store, date, total));
        }
        if (projBatch.length) { await env.DB.batch(projBatch); projected = projBatch.length; }
      }

      return new Response(JSON.stringify({ ok: true, channel, written: batch.length, projected, skipped: errors.length, errors }), { headers: corsJson });
    }

    // ── Admin: re-snapshot item sales for a date: ?action=items-snapshot&store=BL1[&date=2026-04-08]
    // store=all re-processes every store. Requires X-Snapshot-Secret header.
    if (url.searchParams.get("action") === "items-snapshot") {
      const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
      const unauth = requireAdminSecret(request, env, corsJson);
      if (unauth) return unauth;

      const storeParam = (url.searchParams.get("store") || "").toUpperCase();
      if (!storeParam) {
        return new Response(JSON.stringify({ error: "Missing store param (use store=BL1 or store=all)" }), { status: 400, headers: corsJson });
      }
      const stores = storeParam === "ALL" ? ALL_STORES : [storeParam];

      const { dateStr: todayStr } = getETToday();
      const dateParam = url.searchParams.get("date") || todayStr;

      const sinceTs = getStartOfDayET(dateParam);
      let untilTs = null;
      if (dateParam !== todayStr) {
        // Add upper bound so a historical re-snapshot doesn't bleed into the next day
        const nextDay = new Date(dateParam + 'T12:00:00Z');
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        untilTs = getStartOfDayET(nextDay.toISOString().slice(0, 10));
      }

      const [overrides, itemCosts] = await Promise.all([
        fetchItemOverrides(env),
        fetchItemCosts(env),
      ]);
      const results = {};
      for (const store of stores) {
        try {
          const [elements, refundElements, manualRefundElements] = await Promise.all([
            fetchItemOrders(store, env, sinceTs, untilTs),
            fetchRefundElements(store, env, sinceTs, untilTs),
            fetchManualRefunds(store, env, sinceTs, untilTs),
          ]);
          if (!elements) { results[store] = "skipped (no credentials)"; continue; }
          const itemCatMap = await fetchItemCategoryMap(store, env);
          const extraOrders = await fetchCrossDayOrdersForRefunds(store, env, elements, refundElements);
          const itemData = aggregateItemSales(elements, itemCatMap, store, dateParam, overrides, itemCosts, refundElements, extraOrders, manualRefundElements);

          // Zero-order guard: if Clover returned no orders and we already have
          // a non-empty item snapshot for this date, don't overwrite it.
          // Clover's API has a ~90-day retention window; historical re-snapshots
          // return 0 orders and would silently wipe existing good data.
          if (itemData.orderCount === 0 && env.SALES_SNAPSHOTS) {
            const existing = await env.SALES_SNAPSHOTS.get(
              `items:${store.toLowerCase()}:${dateParam}`, "json"
            );
            if (existing?.categories?.length > 0) {
              results[store] = { ok: true, skipped: true, reason: "zero-order guard: existing snapshot preserved", orders: 0 };
              continue;
            }
          }

          await saveItemSalesSnapshot(env, store, dateParam, itemData);
          results[store] = { ok: true, orders: itemData.orderCount, netSales: itemData.totals.netSales };
        } catch (e) {
          results[store] = { error: e.message };
        }
      }
      // Rebuild week-summary KV for the affected week so T13 L2 data is current
      if (env.DB && env.SALES_SNAPSHOTS) {
        const year = dateParam.slice(0, 4);
        const { results: wkRows } = await env.DB.prepare(
          "SELECT DISTINCT week FROM daily_sales WHERE date = ?"
        ).bind(dateParam).all().catch(() => ({ results: [] }));
        for (const { week: wk } of (wkRows || [])) {
          if (!wk) continue;
          const rebuildStores = storeParam === "ALL" ? ALL_STORES : stores;
          await Promise.allSettled(rebuildStores.map(s => writeWeekSummary(env, s, wk, year)));
        }
      }

      return new Response(JSON.stringify({ ok: true, date: dateParam, results }), { headers: corsJson });
    }

    // ── Admin: sales reconciliation diagnostic
    //    ?action=sales-diag&store=BL1&date=2026-04-26
    // Pulls one (store, date) of orders fresh from Clover with EVERY potentially
    // relevant field expanded and dumps every sum that could explain a mismatch
    // between our Net Sales and Clover's Sales Summary report. Read-only: does
    // not write to KV or D1. Used for Phase 1 reconciliation of Option A.
    if (url.searchParams.get("action") === "sales-diag") {
      const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
      const unauth = requireAdminSecret(request, env, corsJson);
      if (unauth) return unauth;

      const store = (url.searchParams.get("store") || "").toUpperCase();
      const dateParam = url.searchParams.get("date");
      if (!store || !dateParam) {
        return new Response(JSON.stringify({ error: "Missing store or date param" }), { status: 400, headers: corsJson });
      }
      const merchantId = env[`${store}_MERCHANT_ID`];
      const apiToken = env[`${store}_API_TOKEN`];
      if (!merchantId || !apiToken) {
        return new Response(JSON.stringify({ error: `No credentials for store ${store}` }), { status: 400, headers: corsJson });
      }

      const sinceTs = getStartOfDayET(dateParam);
      const nextDay = new Date(dateParam + 'T12:00:00Z');
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      const untilTs = getStartOfDayET(nextDay.toISOString().slice(0, 10));

      const headers = { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" };

      // 1) Fetch orders with EVERY relevant expansion for this date.
      //    Clover supports comma-separated expansions; we ask for everything
      //    that could possibly carry a $ figure.
      const orders = [];
      let offset = 0;
      const limit = 1000;
      while (true) {
        const url = `https://api.clover.com/v3/merchants/${merchantId}/orders`
          + `?filter=createdTime>=${sinceTs}`
          + `&filter=createdTime<${untilTs}`
          + `&expand=payments,lineItems.item,lineItems.discounts,lineItems.modifications,lineItems.refunds,discounts,credits,refunds,serviceCharge`
          + `&limit=${limit}&offset=${offset}`;
        const resp = await fetch(url, { headers });
        const data = await resp.json();
        if (!data?.elements?.length) break;
        orders.push(...data.elements);
        if (data.elements.length < limit) break;
        offset += limit;
      }

      // 2) Independently fetch /credits and /refunds for the same window.
      //    Cross-day refunds (refund posted today against a prior-day order)
      //    won't appear in the orders fetch above.
      const fetchEndpoint = async (path) => {
        try {
          const r = await fetch(
            `https://api.clover.com/v3/merchants/${merchantId}/${path}`
            + `?filter=createdTime>=${sinceTs}&filter=createdTime<${untilTs}&limit=1000`,
            { headers }
          );
          if (!r.ok) return { error: `${r.status}`, elements: [] };
          const j = await r.json();
          return j;
        } catch (e) {
          return { error: e.message, elements: [] };
        }
      };
      const [credits, refundsEp] = await Promise.all([
        fetchEndpoint("credits"),
        fetchEndpoint("refunds"),
      ]);

      // 3) Walk orders and sum every potentially-relevant figure (cents).
      const cents = {
        sum_order_total: 0,
        sum_order_taxAmount: 0,        // top-level field (if exists)
        sum_payment_taxAmount: 0,      // current source for our totalNet
        sum_payment_tipAmount: 0,
        sum_order_serviceCharge: 0,
        sum_lineitem_gross: 0,         // Σ price × qty
        sum_lineitem_discounts: 0,     // line-item-attached discounts
        sum_order_discounts: 0,        // order.discounts.elements
        sum_lineitem_refunds: 0,       // lineItem.refunds.elements
        sum_lineitem_mods_negative: 0, // Phase 2B: Σ(|amount|) for negative-amount mods
        sum_lineitem_mods_positive: 0, // Phase 2B: Σ amount for positive mods (surcharges)
        sum_lineitem_mods_total: 0,    // signed sum of all mod amounts (informational)
        negative_lineitem_total: 0,
      };
      const stateBreakdown = {};
      let negativeLineItemCount = 0;
      const topResiduals = [];          // {orderId, residual, total}
      let zeroTotalOrderCount = 0;
      const modSamples = [];            // first 10 modifications, for shape inspection
      let modCount = 0;

      for (const o of orders) {
        stateBreakdown[o.state || "(unknown)"] = (stateBreakdown[o.state || "(unknown)"] || 0) + 1;
        if (o.total == null) continue;
        if (o.total === 0) zeroTotalOrderCount++;

        cents.sum_order_total += (o.total || 0);
        cents.sum_order_taxAmount += (o.taxAmount || 0);
        cents.sum_order_serviceCharge += (o.serviceCharge?.amount ?? o.serviceCharge ?? 0) || 0;

        let orderPmtTax = 0, orderPmtTip = 0;
        for (const p of (o.payments?.elements || [])) {
          orderPmtTax += (p.taxAmount || 0);
          orderPmtTip += (p.tipAmount || 0);
        }
        cents.sum_payment_taxAmount += orderPmtTax;
        cents.sum_payment_tipAmount += orderPmtTip;

        // Phase 2B-aware: percentage-only discounts need to be resolved
        // against post-line-discount subtotal. First pass over line items
        // computes line discounts and the subtotal; then order-level
        // percentage discounts can be evaluated against it.
        let _liGrossSum = 0, _liDiscSum = 0;
        for (const li of (o.lineItems?.elements || [])) {
          const qty = li.unitQty != null ? li.unitQty / 1000 : 1;
          const liGross = Math.abs((li.price || 0) * qty);
          if ((li.price || 0) < 0) continue;
          _liGrossSum += liGross;
          for (const d of (li.discounts?.elements || [])) {
            if (d.amount != null && d.amount !== 0) _liDiscSum += Math.abs(d.amount);
            else if (d.percentage) _liDiscSum += Math.round(liGross * Number(d.percentage) / 100);
          }
        }
        const _subtotalPostLineDisc = _liGrossSum - _liDiscSum;
        for (const d of (o.discounts?.elements || [])) {
          if (d.amount != null && d.amount !== 0) {
            cents.sum_order_discounts += Math.abs(d.amount);
          } else if (d.percentage && _subtotalPostLineDisc > 0) {
            cents.sum_order_discounts += Math.round(_subtotalPostLineDisc * Number(d.percentage) / 100);
          }
        }

        let orderLineItemGross = 0, orderLineItemDisc = 0, orderLineItemRefund = 0;
        for (const li of (o.lineItems?.elements || [])) {
          const qty = li.unitQty != null ? li.unitQty / 1000 : 1;
          const liGross = (li.price || 0) * qty;
          orderLineItemGross += liGross;
          if ((li.price || 0) < 0) {
            negativeLineItemCount++;
            cents.negative_lineitem_total += liGross;
          }
          for (const d of (li.discounts?.elements || [])) {
            if (d.amount != null && d.amount !== 0) {
              orderLineItemDisc += Math.abs(d.amount);
            } else if (d.percentage) {
              orderLineItemDisc += Math.round(Math.abs(liGross) * Number(d.percentage) / 100);
            }
          }
          for (const r of (li.refunds?.elements || [])) {
            orderLineItemRefund += Math.abs(r.amount || 0);
          }
          // Phase 2B inventory: enumerate modifications. Hypothesis is
          // markdowns/sale prices live here as negative-amount mods.
          for (const m of (li.modifications?.elements || [])) {
            modCount++;
            const amount = m.amount || 0;
            cents.sum_lineitem_mods_total += amount;
            if (amount < 0) cents.sum_lineitem_mods_negative += Math.abs(amount);
            else cents.sum_lineitem_mods_positive += amount;
            if (modSamples.length < 10) {
              modSamples.push({
                liName: li.name, liPrice: li.price, liQty: qty,
                modName: m.name, modAmount: amount / 100,
                modAllFields: Object.keys(m),
              });
            }
          }
        }
        cents.sum_lineitem_gross += orderLineItemGross;
        cents.sum_lineitem_discounts += orderLineItemDisc;
        cents.sum_lineitem_refunds += orderLineItemRefund;

        // Residual = order.total − tax(from payments) − Σ(li.gross − li.disc)
        // — the same residual that lands in our "Other / Non-Item" bucket.
        const orderNet = o.total - orderPmtTax;
        const orderLineItemNet = orderLineItemGross - orderLineItemDisc;
        const residual = orderNet - orderLineItemNet;
        if (Math.abs(residual) > 50) { // >$0.50
          topResiduals.push({
            orderId: o.id, total: o.total / 100, residual: residual / 100,
            state: o.state, lineItemCount: (o.lineItems?.elements || []).length,
          });
        }
      }
      topResiduals.sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual));

      const sum_credits = (credits.elements || []).reduce((s, c) => s + (c.amount || 0), 0);
      const sum_refunds_ep = (refundsEp.elements || []).reduce((s, r) => s + (r.amount || 0), 0);

      // 4) Compute candidate "true" net values to triangulate against Clover.
      const ourNet = (cents.sum_order_total - cents.sum_payment_taxAmount) / 100;
      const altNet_orderTax = (cents.sum_order_total - cents.sum_order_taxAmount) / 100;
      const cloverFormulaNet = (cents.sum_lineitem_gross - cents.sum_lineitem_discounts - cents.sum_order_discounts) / 100;
      const ourNet_minus_serviceCharge = ourNet - cents.sum_order_serviceCharge / 100;
      const ourNet_minus_credits = ourNet - sum_credits / 100;
      const ourNet_minus_refunds_ep = ourNet - sum_refunds_ep / 100;
      const ourNet_minus_lineitem_refunds = ourNet - cents.sum_lineitem_refunds / 100;

      const out = {
        store, date: dateParam,
        window: { sinceTs, untilTs, sinceISO: new Date(sinceTs).toISOString(), untilISO: new Date(untilTs).toISOString() },
        orderCount: orders.length,
        zeroTotalOrderCount,
        stateBreakdown,
        // Sums in dollars
        sums_dollars: Object.fromEntries(Object.entries(cents).map(([k, v]) => [k, +(v / 100).toFixed(2)])),
        sum_credits_endpoint: +(sum_credits / 100).toFixed(2),
        sum_refunds_endpoint: +(sum_refunds_ep / 100).toFixed(2),
        credits_count: (credits.elements || []).length,
        refunds_endpoint_count: (refundsEp.elements || []).length,
        credits_endpoint_error: credits.error || null,
        refunds_endpoint_error: refundsEp.error || null,
        // Candidate net values — pick the one that matches Clover Sales Summary
        candidates: {
          ourNet_current: +ourNet.toFixed(2),
          altNet_using_order_taxAmount: +altNet_orderTax.toFixed(2),
          cloverFormula_lineItemGross_minus_allDiscounts: +cloverFormulaNet.toFixed(2),
          ourNet_minus_serviceCharge: +ourNet_minus_serviceCharge.toFixed(2),
          ourNet_minus_credits_endpoint: +ourNet_minus_credits.toFixed(2),
          ourNet_minus_refunds_endpoint: +ourNet_minus_refunds_ep.toFixed(2),
          ourNet_minus_lineitem_refunds: +ourNet_minus_lineitem_refunds.toFixed(2),
        },
        negativeLineItemCount,
        modCount,
        modSamples,
        topResiduals: topResiduals.slice(0, 10),
      };

      return new Response(JSON.stringify(out, null, 2), { headers: corsJson });
    }

    // ── Admin: backfill `items:` KV snapshots across a date range
    //    ?action=backfill-items-snapshots&store=all&start=YYYY-MM-DD&end=YYYY-MM-DD[&force=1]
    // Iterates each date in [start,end] and re-runs the items-snapshot logic,
    // skipping dates that already have a KV entry unless force=1. Restores
    // qty/ASP/L2 data on the Weekly Retail Summary for historical weeks.
    if (url.searchParams.get("action") === "backfill-items-snapshots") {
      const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
      const unauth = requireAdminSecret(request, env, corsJson);
      if (unauth) return unauth;
      if (!env.SALES_SNAPSHOTS) {
        return new Response(JSON.stringify({ error: "KV not configured" }), { status: 500, headers: corsJson });
      }

      const storeParam = (url.searchParams.get("store") || "").toUpperCase();
      const start = url.searchParams.get("start");
      const end = url.searchParams.get("end");
      const force = url.searchParams.get("force") === "1";
      if (!storeParam) {
        return new Response(JSON.stringify({ error: "Missing store param (use store=BL1 or store=all)" }), { status: 400, headers: corsJson });
      }
      if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
        return new Response(JSON.stringify({ error: "Missing or invalid start/end (YYYY-MM-DD)" }), { status: 400, headers: corsJson });
      }
      const stores = storeParam === "ALL" ? ALL_STORES : [storeParam];
      const { dateStr: todayStr } = getETToday();

      // Build date list
      const dates = [];
      const cur = new Date(start + "T00:00:00Z");
      const endDate = new Date(end + "T00:00:00Z");
      while (cur <= endDate) {
        dates.push(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
      }

      const [overrides, itemCosts] = await Promise.all([
        fetchItemOverrides(env),
        fetchItemCosts(env),
      ]);
      const catMapCache = {};
      const summary = {};
      for (const store of stores) {
        const storeOut = { written: 0, skipped: 0, errors: 0, details: [] };
        try {
          catMapCache[store] = catMapCache[store] || await fetchItemCategoryMap(store, env);
        } catch (e) {
          storeOut.errors++;
          storeOut.details.push({ error: `category map: ${e.message}` });
          summary[store] = storeOut;
          continue;
        }
        for (const dateStr of dates) {
          const key = `items:${store.toLowerCase()}:${dateStr}`;
          try {
            if (!force) {
              const existing = await env.SALES_SNAPSHOTS.get(key);
              if (existing) { storeOut.skipped++; continue; }
            }
            const sinceTs = getStartOfDayET(dateStr);
            let untilTs = null;
            if (dateStr !== todayStr) {
              const nextDay = new Date(dateStr + 'T12:00:00Z');
              nextDay.setUTCDate(nextDay.getUTCDate() + 1);
              untilTs = getStartOfDayET(nextDay.toISOString().slice(0, 10));
            }
            const [elements, refundElements] = await Promise.all([
              fetchItemOrders(store, env, sinceTs, untilTs),
              fetchRefundElements(store, env, sinceTs, untilTs),
            ]);
            if (!elements) { storeOut.details.push({ date: dateStr, note: "no credentials" }); continue; }
            const itemData = aggregateItemSales(elements, catMapCache[store], store, dateStr, overrides, itemCosts, refundElements);
            await saveItemSalesSnapshot(env, store, dateStr, itemData);
            storeOut.written++;
          } catch (e) {
            storeOut.errors++;
            storeOut.details.push({ date: dateStr, error: e.message });
          }
        }
        summary[store] = storeOut;
      }
      return new Response(JSON.stringify({ ok: true, start, end, force, summary }), { headers: corsJson });
    }

    // ── Admin: list items that fell into "Custom Sales" for a date range
    //    ?action=noncategorized-items&store=BL1&start=YYYY-MM-DD&end=YYYY-MM-DD
    // Reads `items:<store>:<date>` KV snapshots and unions every `_debug.noCategory`
    // entry, returning [{name, itemId, qty, net}] sorted by net desc. Requires the
    // same X-Snapshot-Secret header as other admin endpoints.
    if (url.searchParams.get("action") === "noncategorized-items") {
      const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
      const unauth = requireAdminSecret(request, env, corsJson);
      if (unauth) return unauth;
      if (!env.SALES_SNAPSHOTS) {
        return new Response(JSON.stringify({ error: "KV not configured" }), { status: 500, headers: corsJson });
      }

      const storeParam = (url.searchParams.get("store") || "").toUpperCase();
      if (!storeParam) {
        return new Response(JSON.stringify({ error: "Missing store param" }), { status: 400, headers: corsJson });
      }
      const start = url.searchParams.get("start");
      const end = url.searchParams.get("end");
      if (!start || !end) {
        return new Response(JSON.stringify({ error: "Missing start or end param (YYYY-MM-DD)" }), { status: 400, headers: corsJson });
      }

      // Union { name → {qty, net, itemId} } and { l3 → {qty, net} } across the range.
      const agg = {};
      const l3Agg = {};
      const current = new Date(start + "T00:00:00Z");
      const endDate = new Date(end + "T00:00:00Z");
      const datesScanned = [];
      while (current <= endDate) {
        const dateStr = current.toISOString().slice(0, 10);
        datesScanned.push(dateStr);
        const snap = await env.SALES_SNAPSHOTS.get(
          `items:${storeParam.toLowerCase()}:${dateStr}`, "json"
        );
        const noCat = snap?._debug?.noCategory;
        if (noCat && typeof noCat === "object") {
          for (const [name, val] of Object.entries(noCat)) {
            // Legacy shape was plain count (number). New shape is {qty, net, itemId}.
            let qty = 0, net = 0, itemId = null;
            if (typeof val === "number") {
              qty = val;
            } else if (val && typeof val === "object") {
              qty = Number(val.qty) || 0;
              net = Number(val.net) || 0;
              itemId = val.itemId || null;
            }
            const prior = agg[name] || { name, itemId: null, qty: 0, net: 0 };
            prior.qty += qty;
            prior.net += net;
            if (!prior.itemId && itemId) prior.itemId = itemId;
            agg[name] = prior;
          }
        }
        const uL3 = snap?._debug?.unmappedL3;
        if (uL3 && typeof uL3 === "object") {
          for (const [l3, val] of Object.entries(uL3)) {
            let qty = 0, net = 0;
            if (typeof val === "number") {
              qty = val;
            } else if (val && typeof val === "object") {
              qty = Number(val.qty) || 0;
              net = Number(val.net) || 0;
            }
            const prior = l3Agg[l3] || { l3, qty: 0, net: 0 };
            prior.qty += qty;
            prior.net += net;
            l3Agg[l3] = prior;
          }
        }
        current.setUTCDate(current.getUTCDate() + 1);
      }

      const items = Object.values(agg)
        .map(i => ({ ...i, qty: roundCents(i.qty), net: roundCents(i.net) }))
        .sort((a, b) => b.net - a.net);
      const l3Categories = Object.values(l3Agg)
        .map(i => ({ ...i, qty: roundCents(i.qty), net: roundCents(i.net) }))
        .sort((a, b) => b.net - a.net);

      return new Response(JSON.stringify({
        store: storeParam, start, end, datesScanned, items, l3Categories,
      }), { headers: corsJson });
    }

    // ── Admin: read the current override map
    //    GET  ?action=item-overrides  → { items, patterns }
    //    POST ?action=item-overrides  with body { items?, patterns? }
    //       Merges into the existing KV record. Pass the full `items` object to
    //       replace per-item assignments wholesale; pass the full `patterns` array
    //       to replace the rule list. Either key can be omitted to preserve it.
    if (url.searchParams.get("action") === "item-overrides") {
      const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
      const unauth = requireAdminSecret(request, env, corsJson);
      if (unauth) return unauth;
      if (!env.SALES_SNAPSHOTS) {
        return new Response(JSON.stringify({ error: "KV not configured" }), { status: 500, headers: corsJson });
      }

      if (request.method === "GET") {
        const current = await fetchItemOverrides(env);
        return new Response(JSON.stringify(current), { headers: corsJson });
      }

      if (request.method === "POST") {
        let body;
        try { body = await request.json(); }
        catch { return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: corsJson }); }

        const existing = await fetchItemOverrides(env);
        const next = {
          items: existing.items || {},
          patterns: existing.patterns || [],
          l3Map: existing.l3Map || {},
        };

        if (body && typeof body.items === "object" && body.items !== null) {
          // Validate every L2 before persisting. Reject wholesale on first bad
          // value so admins don't silently write a typo that kills categorization.
          for (const [k, v] of Object.entries(body.items)) {
            if (!VALID_L2.has(v)) {
              return new Response(JSON.stringify({
                error: `Invalid L2 "${v}" for item "${k}". Allowed: ${[...VALID_L2].join(", ")}`
              }), { status: 400, headers: corsJson });
            }
          }
          next.items = body.items;
        }

        if (Array.isArray(body?.patterns)) {
          for (const p of body.patterns) {
            if (!p || !["prefix", "contains", "im-number"].includes(p.type) || !p.value || !p.category) {
              return new Response(JSON.stringify({
                error: "Each pattern needs {type: prefix|contains|im-number, value, category}"
              }), { status: 400, headers: corsJson });
            }
            if (!VALID_L2.has(p.category)) {
              return new Response(JSON.stringify({
                error: `Invalid L2 "${p.category}" in pattern rule`
              }), { status: 400, headers: corsJson });
            }
          }
          next.patterns = body.patterns;
        }

        if (body && typeof body.l3Map === "object" && body.l3Map !== null) {
          for (const [k, v] of Object.entries(body.l3Map)) {
            if (!VALID_L2.has(v)) {
              return new Response(JSON.stringify({
                error: `Invalid L2 "${v}" for L3 "${k}". Allowed: ${[...VALID_L2].join(", ")}`
              }), { status: 400, headers: corsJson });
            }
          }
          next.l3Map = body.l3Map;
        }

        await env.SALES_SNAPSHOTS.put(ITEM_OVERRIDES_KEY, JSON.stringify(next));
        return new Response(JSON.stringify({ ok: true, ...next }), { headers: corsJson });
      }

      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsJson });
    }

    // ── Admin: read or replace the global Item Master cost map.
    //    GET  ?action=item-costs              → { items, importedAt, count }
    //    POST ?action=item-costs  with body { items: { "<itemNo>": { cost, desc } } }
    //       Authoritative replace (not merge) — admin always uploads the full
    //       parsed file. Validates each entry before persisting.
    if (url.searchParams.get("action") === "item-costs") {
      const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
      const unauth = requireAdminSecret(request, env, corsJson);
      if (unauth) return unauth;
      if (!env.SALES_SNAPSHOTS) {
        return new Response(JSON.stringify({ error: "KV not configured" }), { status: 500, headers: corsJson });
      }

      if (request.method === "GET") {
        const current = await fetchItemCosts(env);
        return new Response(JSON.stringify(current), { headers: corsJson });
      }

      if (request.method === "POST") {
        let body;
        try { body = await request.json(); }
        catch { return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: corsJson }); }

        // merge:true → patch the existing map (add/update `items`, remove `delete`d
        // IM#s) instead of replacing it. Default (no flag) stays authoritative-
        // replace, so the full-file uploader keeps wiping-and-rewriting as before.
        const merge = body?.merge === true;
        const rawItems = body?.items;
        const delList = Array.isArray(body?.delete) ? body.delete : [];
        if ((!rawItems || typeof rawItems !== "object") && !(merge && delList.length)) {
          return new Response(JSON.stringify({ error: "Body must include items: { itemNo: { cost, desc } }" }), { status: 400, headers: corsJson });
        }

        const cleaned = {};
        let rejected = 0;
        for (const [k, v] of Object.entries(rawItems || {})) {
          if (!/^\d{4,5}$/.test(String(k))) { rejected++; continue; }
          const cost = Number(v?.cost);
          if (!Number.isFinite(cost) || cost < 0) { rejected++; continue; }
          cleaned[String(k)] = {
            cost: Math.round(cost * 10000) / 10000,
            desc: typeof v?.desc === "string" ? v.desc : "",
          };
        }

        let finalItems;
        let deleted = 0;
        if (merge) {
          const existing = await env.SALES_SNAPSHOTS.get(ITEM_COSTS_KEY, "json");
          const base = (existing && typeof existing === "object" && existing.items && typeof existing.items === "object") ? existing.items : {};
          finalItems = { ...base, ...cleaned };
          for (const d of delList) {
            const key = String(d);
            if (/^\d{4,5}$/.test(key) && key in finalItems) { delete finalItems[key]; deleted++; }
          }
        } else {
          finalItems = cleaned;
        }

        const payload = {
          items: finalItems,
          importedAt: new Date().toISOString(),
          count: Object.keys(finalItems).length,
        };
        await env.SALES_SNAPSHOTS.put(ITEM_COSTS_KEY, JSON.stringify(payload));
        return new Response(JSON.stringify({ ok: true, count: payload.count, rejected, deleted, merged: merge, importedAt: payload.importedAt }), { headers: corsJson });
      }

      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsJson });
    }

    // ── Admin: Per-L3-category flat $/unit costs ───────────────────────────
    //    GET  ?action=category-costs → { costs, categories:[{l3,l2}], importedAt, count }
    //    POST ?action=category-costs  body { costs: { "<l3 category>": number } }
    //       Authoritative replace. Validates each L3 against the curated
    //       L3_TO_L2 map and each cost as a finite, non-negative number.
    if (url.searchParams.get("action") === "category-costs") {
      const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
      const unauth = requireAdminSecret(request, env, corsJson);
      if (unauth) return unauth;
      if (!env.SALES_SNAPSHOTS) {
        return new Response(JSON.stringify({ error: "KV not configured" }), { status: 500, headers: corsJson });
      }

      // The set of L3 categories the dashboard knows how to bucket, grouped by L2.
      const catalog = Object.entries(L3_TO_L2)
        .map(([l3, l2]) => ({ l3, l2 }))
        .sort((a, b) => (a.l2 === b.l2 ? a.l3.localeCompare(b.l3) : a.l2.localeCompare(b.l2)));

      if (request.method === "GET") {
        const stored = await env.SALES_SNAPSHOTS.get(CATEGORY_COSTS_KEY, "json");
        const s = (stored && typeof stored === "object") ? stored : {};

        // Recent sales per L3 (last 7 days, all stores) so the editor can show
        // which categories actually have sales and sort them to the top. Name-
        // matched rows ("[Name match] X") are attributed back to their L3 key X.
        // Best-effort: a snapshot miss just contributes nothing.
        const salesByL3 = {};
        try {
          const { dateStr: today } = getETToday();
          const cur = new Date(today + "T00:00:00Z");
          const keys = [];
          for (let i = 0; i < 7; i++) {
            const dt = cur.toISOString().slice(0, 10);
            for (const st of ALL_STORES) keys.push(`items:${st.toLowerCase()}:${dt}`);
            cur.setUTCDate(cur.getUTCDate() - 1);
          }
          const snaps = await Promise.all(keys.map(k => env.SALES_SNAPSHOTS.get(k, "json").catch(() => null)));
          for (const snap of snaps) {
            if (!snap || !Array.isArray(snap.categories)) continue;
            for (const c of snap.categories) {
              for (const l of (c.l3Rows || [])) {
                let key = l.l3 || "";
                if (key.startsWith("[Name match] ")) key = key.slice(13);
                if (!Object.prototype.hasOwnProperty.call(L3_TO_L2, key)) continue;
                const b = salesByL3[key] || { qty: 0, net: 0 };
                b.qty += Number(l.qty) || 0;
                b.net += Number(l.netSales) || 0;
                salesByL3[key] = b;
              }
            }
          }
          for (const k of Object.keys(salesByL3)) {
            salesByL3[k].qty = Math.round(salesByL3[k].qty);
            salesByL3[k].net = roundCents(salesByL3[k].net);
          }
        } catch (e) { /* sales is best-effort */ }

        return new Response(JSON.stringify({
          costs: s.costs && typeof s.costs === "object" ? s.costs : {},
          categories: catalog,
          sales: salesByL3,
          importedAt: s.importedAt || null,
          count: Number(s.count) || 0,
        }), { headers: corsJson });
      }

      if (request.method === "POST") {
        let body;
        try { body = await request.json(); }
        catch { return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: corsJson }); }

        const rawCosts = body?.costs;
        if (!rawCosts || typeof rawCosts !== "object") {
          return new Response(JSON.stringify({ error: "Body must include costs: { \"<l3 category>\": number }" }), { status: 400, headers: corsJson });
        }

        const cleaned = {};
        let rejected = 0;
        for (const [l3, v] of Object.entries(rawCosts)) {
          if (!Object.prototype.hasOwnProperty.call(L3_TO_L2, l3)) { rejected++; continue; }
          const cost = Number(v);
          if (!Number.isFinite(cost) || cost < 0) { rejected++; continue; }
          if (cost === 0) continue; // omit zeros — absence means "no cost set"
          cleaned[l3] = Math.round(cost * 10000) / 10000;
        }
        const payload = { costs: cleaned, importedAt: new Date().toISOString(), count: Object.keys(cleaned).length };
        await env.SALES_SNAPSHOTS.put(CATEGORY_COSTS_KEY, JSON.stringify(payload));
        return new Response(JSON.stringify({ ok: true, count: payload.count, rejected, importedAt: payload.importedAt }), { headers: corsJson });
      }

      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsJson });
    }

    // ── Admin: Fetch Clover categories for a store (5-min KV cache)
    //    GET ?action=clover-categories&store=BL1
    if (url.searchParams.get("action") === "clover-categories") {
      const unauth = requireInventoryAccess(currentUser, isAdminSecret, corsJson);
      if (unauth) return unauth;
      const store = (url.searchParams.get("store") || "").toUpperCase();
      if (!ALL_STORES.includes(store)) {
        return new Response(JSON.stringify({ error: "Invalid store" }), { status: 400, headers: corsJson });
      }
      const cacheKey = `clover-categories:${store}`;
      const cached = await env.SALES_SNAPSHOTS.get(cacheKey, "json");
      if (cached) {
        return new Response(JSON.stringify(cached), { headers: corsJson });
      }
      const merchantId = env[`${store}_MERCHANT_ID`];
      const apiToken = env[`${store}_API_TOKEN`];
      if (!merchantId || !apiToken) {
        return new Response(JSON.stringify({ error: "Store not configured" }), { status: 500, headers: corsJson });
      }
      const catResp = await fetch(`https://api.clover.com/v3/merchants/${merchantId}/categories?limit=1000`, {
        headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
      });
      if (!catResp.ok) {
        const txt = await catResp.text();
        return new Response(JSON.stringify({ error: `Clover error: ${catResp.status}`, detail: txt }), { status: 502, headers: corsJson });
      }
      const catData = await catResp.json();
      await env.SALES_SNAPSHOTS.put(cacheKey, JSON.stringify(catData), { expirationTtl: 300 });
      return new Response(JSON.stringify(catData), { headers: corsJson });
    }

    // ── Admin: Create a Clover item (per-store or all stores)
    //    POST ?action=create-clover-item
    if (url.searchParams.get("action") === "create-clover-item") {
      const unauth = requireInventoryAccess(currentUser, isAdminSecret, corsJson);
      if (unauth) return unauth;
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsJson });
      }
      const body = await request.json();
      const { store, name, code, priceCents, costCents, taxable, hidden, l2, l3 } = body;
      if (!name || !code || !priceCents || !l2 || !l3) {
        return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: corsJson });
      }
      const targetStores = (store === "all") ? ALL_STORES : [String(store).toUpperCase()];

      async function createItemForStore(s) {
        try {
          const mId = env[`${s}_MERCHANT_ID`];
          const tok = env[`${s}_API_TOKEN`];
          if (!mId || !tok) return { store: s, ok: false, error: "Store not configured", stage: "config" };
          const headers = { "Authorization": `Bearer ${tok}`, "Content-Type": "application/json" };

          // Duplicate check: look for existing item with same code
          const dupResp = await cloverFetch(
            `https://api.clover.com/v3/merchants/${mId}/items?filter=code%3D${encodeURIComponent(code)}&limit=5`,
            { headers }
          );
          if (dupResp.ok) {
            const dupData = await dupResp.json();
            if ((dupData.elements || []).length > 0) {
              const existing = dupData.elements[0];
              return { store: s, ok: false, duplicate: true, existingId: existing.id, error: "Item with this code already exists" };
            }
          }

          const { categoryId, created: categoryCreated } = await resolveCloverCategory(s, l3, env);

          const itemBody = { name, code, sku: code, price: priceCents, hidden: !!hidden, defaultTaxRates: !!taxable, priceType: "FIXED" };
          if (costCents != null) itemBody.cost = costCents;
          const itemResp = await cloverFetch(`https://api.clover.com/v3/merchants/${mId}/items`, {
            method: "POST", headers, body: JSON.stringify(itemBody),
          });
          if (!itemResp.ok) {
            const txt = await itemResp.text();
            return { store: s, ok: false, error: txt, stage: "item" };
          }
          const item = await itemResp.json();
          const itemId = item.id;

          const assocResp = await cloverFetch(`https://api.clover.com/v3/merchants/${mId}/category_items`, {
            method: "POST", headers,
            body: JSON.stringify({ elements: [{ category: { id: categoryId }, item: { id: itemId } }] }),
          });
          if (!assocResp.ok) {
            const txt = await assocResp.text();
            return { store: s, ok: false, error: txt, stage: "associate" };
          }

          return { store: s, ok: true, itemId, categoryId, categoryCreated };
        } catch (err) {
          return { store: s, ok: false, error: err.message, stage: "categories" };
        }
      }

      const results = await Promise.all(targetStores.map(s => createItemForStore(s)));

      // Cost KV merge (only if costCents provided)
      let costUpdated = false;
      if (costCents != null) {
        const costs = await fetchItemCosts(env);
        const isNew = !costs.items[code];
        costs.items[code] = { cost: costCents / 100, desc: name };
        if (isNew) costs.count = (costs.count || 0) + 1;
        costs.importedAt = new Date().toISOString();
        await env.SALES_SNAPSHOTS.put(ITEM_COSTS_KEY, JSON.stringify(costs));
        costUpdated = true;
      }

      // L3→L2 mapping merge (only if not already mapped)
      let l3Mapped = false;
      const overrides = await fetchItemOverrides(env);
      if (!overrides.l3Map[l3]) {
        overrides.l3Map[l3] = l2;
        await env.SALES_SNAPSHOTS.put(ITEM_OVERRIDES_KEY, JSON.stringify(overrides));
        l3Mapped = true;
      }

      return new Response(JSON.stringify({ results, costUpdated, l3Mapped }), { headers: corsJson });
    }

    // ── Admin: Inventory Items (paginated)
    //    GET ?action=inventory-items&store=BL1&offset=0
    if (url.searchParams.get("action") === "inventory-items") {
      const unauth = requireInventoryAccess(currentUser, isAdminSecret, corsJson);
      if (unauth) return unauth;
      const store = url.searchParams.get("store") || "";
      const offset = parseInt(url.searchParams.get("offset") || "0", 10);
      if (!ALL_STORES.includes(store)) {
        return new Response(JSON.stringify({ ok: false, error: "Invalid store" }), { status: 400, headers: corsJson });
      }
      const mId = env[`${store}_MERCHANT_ID`];
      const tok = env[`${store}_API_TOKEN`];
      const apiUrl = `https://api.clover.com/v3/merchants/${mId}/items?expand=categories&limit=1000&offset=${offset}`;
      const resp = await cloverFetch(apiUrl, { headers: { "Authorization": `Bearer ${tok}` } });
      if (!resp.ok) {
        const txt = await resp.text();
        return new Response(JSON.stringify({ ok: false, error: txt }), { status: resp.status, headers: corsJson });
      }
      const data = await resp.json();
      const elements = (data.elements || []).map(item => ({
        id: item.id,
        name: item.name || "",
        code: item.code || "",
        sku: item.sku || "",
        price: item.price || 0,
        cost: item.cost || 0,
        hidden: item.hidden || false,
        defaultTaxRates: item.defaultTaxRates || false,
        priceType: item.priceType || "FIXED",
        modifiedTime: item.modifiedTime || 0,
        category: item.categories?.elements?.[0]?.name || "",
        categoryId: item.categories?.elements?.[0]?.id || "",
      }));
      const total = data.total ?? data.count ?? null;
      const hasMore = elements.length === 1000;
      return new Response(JSON.stringify({ ok: true, elements, offset, total, hasMore }), { headers: corsJson });
    }

    // ── Admin: Update Clover Item
    //    POST ?action=update-clover-item  body: { store, itemId, name, code, priceCents, costCents, taxable, hidden, l3, currentCategoryId }
    if (url.searchParams.get("action") === "update-clover-item") {
      const unauth = requireInventoryAccess(currentUser, isAdminSecret, corsJson);
      if (unauth) return unauth;
      const body = await request.json();
      const { store, itemId, name, code, priceCents, costCents, taxable, hidden, l3, currentCategoryId } = body;
      if (!ALL_STORES.includes(store) || !itemId) {
        return new Response(JSON.stringify({ ok: false, error: "Invalid store or itemId" }), { status: 400, headers: corsJson });
      }
      const mId = env[`${store}_MERCHANT_ID`];
      const tok = env[`${store}_API_TOKEN`];
      const authHeaders = { "Authorization": `Bearer ${tok}`, "Content-Type": "application/json" };

      // Build scalar patch — only include defined fields
      const patch = {};
      if (name !== undefined) patch.name = name;
      if (code !== undefined) { patch.code = code; patch.sku = code; }
      if (priceCents !== undefined) patch.price = priceCents;
      if (costCents !== undefined) patch.cost = costCents;
      if (taxable !== undefined) patch.defaultTaxRates = taxable;
      if (hidden !== undefined) patch.hidden = hidden;

      const patchResp = await cloverFetch(
        `https://api.clover.com/v3/merchants/${mId}/items/${itemId}`,
        { method: "POST", headers: authHeaders, body: JSON.stringify(patch) }
      );
      if (!patchResp.ok) {
        const txt = await patchResp.text();
        return new Response(JSON.stringify({ ok: false, error: txt, stage: "patch" }), { status: patchResp.status, headers: corsJson });
      }
      const updatedItem = await patchResp.json();

      // Handle category reassignment if l3 was sent
      if (l3 !== undefined) {
        // Remove existing category associations for this item
        const itemCatUrl = `https://api.clover.com/v3/merchants/${mId}/category_items?filter=item.id%3D${itemId}`;
        const catItemsResp = await cloverFetch(itemCatUrl, { headers: { "Authorization": `Bearer ${tok}` } });
        if (catItemsResp.ok) {
          const catData = await catItemsResp.json();
          for (const assoc of (catData.elements || [])) {
            await cloverFetch(
              `https://api.clover.com/v3/merchants/${mId}/category_items/${assoc.id}`,
              { method: "DELETE", headers: { "Authorization": `Bearer ${tok}` } }
            );
          }
        }
        // Assign new category if l3 is non-empty
        if (l3) {
          const newCatId = await resolveCloverCategory(store, l3, env);
          if (newCatId) {
            await cloverFetch(
              `https://api.clover.com/v3/merchants/${mId}/category_items`,
              { method: "POST", headers: authHeaders, body: JSON.stringify({ elements: [{ category: { id: newCatId }, item: { id: itemId } }] }) }
            );
          }
        }
      }

      return new Response(JSON.stringify({ ok: true, item: updatedItem }), { headers: corsJson });
    }

    // ── Admin: Delete Clover Item
    //    POST ?action=delete-clover-item  body: { store, itemId } OR { stores: ["BL1","BL2"], itemId }
    if (url.searchParams.get("action") === "delete-clover-item") {
      const unauth = requireInventoryAccess(currentUser, isAdminSecret, corsJson);
      if (unauth) return unauth;
      const body = await request.json();
      const { itemId } = body;
      const storesToDelete = body.stores
        ? body.stores.filter(s => ALL_STORES.includes(s))
        : (ALL_STORES.includes(body.store) ? [body.store] : []);
      if (!itemId || storesToDelete.length === 0) {
        return new Response(JSON.stringify({ ok: false, error: "Invalid itemId or store(s)" }), { status: 400, headers: corsJson });
      }
      const results = await Promise.all(storesToDelete.map(async s => {
        const mId = env[`${s}_MERCHANT_ID`];
        const tok = env[`${s}_API_TOKEN`];
        const delResp = await cloverFetch(
          `https://api.clover.com/v3/merchants/${mId}/items/${itemId}`,
          { method: "DELETE", headers: { "Authorization": `Bearer ${tok}` } }
        );
        if (delResp.ok || delResp.status === 404) {
          return { store: s, ok: true };
        }
        const txt = await delResp.text();
        return { store: s, ok: false, error: txt };
      }));
      return new Response(JSON.stringify({ results }), { headers: corsJson });
    }

    // ── Public: Weekly Retail Summary feed
    //    ?action=weekly-summary&week=15&year=2026
    // Returns one payload feeding the Summary tab + all 6 per-store tabs.
    if (url.searchParams.get("action") === "weekly-summary") {
      const week = url.searchParams.get("week");
      const year = url.searchParams.get("year") || String(new Date().getUTCFullYear());
      if (!week) {
        return new Response(JSON.stringify({ error: "Missing week param" }), { status: 400, headers: corsJson });
      }

      try {
        const dates = await resolveWeekDates(env, week, year);
        if (!dates.length) {
          return new Response(JSON.stringify({
            week, year: Number(year), dates: [], stores: {}, company: { totals: {}, l2Matrix: [] },
            note: "No daily_sales rows found for this week.",
          }), { headers: corsJson });
        }

        // Scope stores to what the current user is allowed to see
        const scopedStores = allowedStores(currentUser)
          ? ALL_STORES.filter(s => allowedStores(currentUser).includes(s))
          : ALL_STORES;

        const bundles = await Promise.all(
          scopedStores.map(s => buildStoreWeekly(env, s, dates))
        );
        const stores = {};
        scopedStores.forEach((s, i) => { stores[s] = bundles[i]; });

        // Company totals (sum of scoped stores)
        let cNet = 0, cRetail = 0, cBin = 0, cAuction = 0, cBudget = 0,
            cQty = 0, cTxn = 0, cLaborNum = 0, cLaborDen = 0;
        for (const b of bundles) {
          cNet += b.totals.netSales;
          cRetail += b.totals.retail;
          cBin += b.totals.bin;
          cAuction += b.totals.auction;
          cBudget += b.totals.budget;
          cQty += b.totals.qty;
          cTxn += b.totals.transactions;
          if (b.totals.netSales > 0) {
            cLaborNum += b.totals.laborPct * b.totals.netSales;
            cLaborDen += b.totals.netSales;
          }
        }
        // ASP excludes auction (auction has no qty — would inflate per-item avg)
        const cAsp = cQty > 0 ? (cNet - cAuction) / cQty : 0;
        const cVar = cNet - cBudget;
        const cVarPct = cBudget > 0 ? (cVar / cBudget) * 100 : 0;
        const cLabor = cLaborDen > 0 ? cLaborNum / cLaborDen : 0;

        // L2 × store matrix (scoped stores only). Since buildStoreWeekly now
        // injects an "Auction" row into each bundle's itemSales.categories,
        // the matrix automatically includes it — no special-case needed here.
        // The matrix grand total now equals the KPI table Net Sales.
        const l2Set = new Set();
        for (const b of bundles) {
          for (const c of b.itemSales.categories) l2Set.add(c.category);
        }
        const l2Matrix = [];
        for (const l2 of l2Set) {
          const row = { l2, byStore: {}, total: 0 };
          scopedStores.forEach((s, i) => {
            const found = bundles[i].itemSales.categories.find(c => c.category === l2);
            const v = found ? found.netSales : 0;
            row.byStore[s] = v;
            row.total += v;
          });
          row.total = roundCents(row.total);
          l2Matrix.push(row);
        }
        l2Matrix.sort((a, b) => b.total - a.total);

        return new Response(JSON.stringify({
          week, year: Number(year), dates,
          stores,
          company: {
            totals: {
              netSales: roundCents(cNet),
              retail: roundCents(cRetail),
              bin: roundCents(cBin),
              auction: roundCents(cAuction),
              budget: roundCents(cBudget),
              qty: cQty,
              transactions: cTxn,
              asp: roundCents(cAsp),
              varianceDollar: roundCents(cVar),
              variancePct: Math.round(cVarPct * 10) / 10,
              laborPct: Math.round(cLabor * 10) / 10,
            },
            l2Matrix,
          },
        }), { headers: corsJson });
      } catch (err) {
        return new Response(JSON.stringify({ error: "weekly-summary failed", detail: err.message }), { status: 500, headers: corsJson });
      }
    }

    // ── Public: trailing 13-week summary feed
    //    ?action=weekly-t13&endWeek=15&year=2026
    // Reads from pre-rolled `week-summary:` KV keys; falls back to live aggregation
    // for any missing key (and logs a warning).
    if (url.searchParams.get("action") === "weekly-t13") {
      const endWeek = url.searchParams.get("endWeek");
      const year = url.searchParams.get("year") || String(new Date().getUTCFullYear());
      if (!endWeek) {
        return new Response(JSON.stringify({ error: "Missing endWeek param" }), { status: 400, headers: corsJson });
      }

      try {
        // Resolve 13 ordered weeks ending at endWeek. Trust D1 to enumerate
        // weeks (sheet-derived). If endWeek date hasn't been imported, fall
        // back to numeric range.
        let weeks = [];
        if (env.DB) {
          // Find the latest date for endWeek to anchor the trailing window
          const anchor = await env.DB.prepare(
            "SELECT MAX(date) as d FROM daily_sales WHERE week = ? AND date LIKE ?"
          ).bind(String(endWeek), `${year}-%`).first();
          const anchorDate = anchor?.d;
          if (anchorDate) {
            const { results } = await env.DB.prepare(
              `SELECT week, MIN(date) as start_date, MAX(date) as end_date
               FROM daily_sales WHERE date <= ?
               GROUP BY week ORDER BY MIN(date) DESC LIMIT 13`
            ).bind(anchorDate).all();
            weeks = (results || []).reverse().map(r => ({
              week: String(r.week),
              start: r.start_date,
              end: r.end_date,
            }));
          }
        }
        if (!weeks.length) {
          // Fallback: numeric range ending at endWeek
          const ew = parseInt(endWeek, 10);
          const yr = parseInt(year, 10);
          for (let i = 12; i >= 0; i--) {
            const w = ew - i;
            if (w < 1) continue;
            const dates = getISOWeekDates(yr, w);
            weeks.push({ week: String(w), start: dates[0], end: dates[6] });
          }
        }

        // Build per-store time series. Read pre-rolled summaries first; on
        // miss, build live for that one (store, week).
        const scopedStoresT13 = allowedStores(currentUser)
          ? ALL_STORES.filter(s => allowedStores(currentUser).includes(s))
          : ALL_STORES;
        const stores = {};
        for (const s of scopedStoresT13) {
          stores[s] = {
            netSales: [], qty: [], transactions: [], asp: [], laborPct: [], budget: [],
          };
        }
        const total = {
          netSales: [], qty: [], transactions: [], asp: [], laborPct: [], budget: [],
        };

        let liveBuilds = 0;
        const l2UnitsByWeek = []; // one entry per week: { L2Name: combinedQty }
        const l2NetByWeek = [];   // one entry per week: { L2Name: combinedNetSales }
        // Per-store L2 arrays: one entry per week, each is { storeKey: { L2Name: qty/net } }.
        // Lets the frontend recompute combined cards when the user filters
        // to a subset of stores without an extra API round-trip.
        const perStoreL2UnitsByWeek = [];
        const perStoreL2NetByWeek = [];
        for (const wkObj of weeks) {
          const wk = wkObj.week;
          const perStore = {};
          const perStoreL2 = {};
          const perStoreL2Net = {};
          await Promise.all(scopedStoresT13.map(async (s) => {
            let summary = null;
            if (env.SALES_SNAPSHOTS) {
              summary = await env.SALES_SNAPSHOTS.get(
                `week-summary:${s.toLowerCase()}:${wk}-${year}`, "json"
              );
            }
            if (!summary) {
              liveBuilds++;
              const dates = await resolveWeekDates(env, wk, year);
              if (dates.length) {
                const bundle = await buildStoreWeekly(env, s, dates);
                summary = { totals: bundle.totals, l2Qty: bundle.l2Qty, l2Net: bundle.l2Net };
              } else {
                summary = { totals: { netSales: 0, qty: 0, transactions: 0, asp: 0, laborPct: 0, budget: 0 }, l2Qty: {}, l2Net: {} };
              }
            }
            perStore[s] = summary.totals;
            perStoreL2[s] = summary.l2Qty || {};
            perStoreL2Net[s] = summary.l2Net || {};
          }));

          let wkNet = 0, wkQty = 0, wkTxn = 0, wkBudget = 0, wkLaborNum = 0, wkLaborDen = 0, wkAuction = 0;
          for (const s of scopedStoresT13) {
            const t = perStore[s] || {};
            stores[s].netSales.push(Number(t.netSales) || 0);
            stores[s].qty.push(Number(t.qty) || 0);
            stores[s].transactions.push(Number(t.transactions) || 0);
            stores[s].asp.push(Number(t.asp) || 0);
            stores[s].laborPct.push(Number(t.laborPct) || 0);
            stores[s].budget.push(Number(t.budget) || 0);
            wkNet += Number(t.netSales) || 0;
            wkQty += Number(t.qty) || 0;
            wkTxn += Number(t.transactions) || 0;
            wkBudget += Number(t.budget) || 0;
            wkAuction += Number(t.auction) || 0;
            const tn = Number(t.netSales) || 0;
            if (tn > 0) {
              wkLaborNum += (Number(t.laborPct) || 0) * tn;
              wkLaborDen += tn;
            }
          }
          total.netSales.push(roundCents(wkNet));
          total.qty.push(wkQty);
          total.transactions.push(wkTxn);
          // ASP excludes auction so per-item averages aren't inflated
          total.asp.push(wkQty > 0 ? roundCents((wkNet - wkAuction) / wkQty) : 0);
          total.laborPct.push(wkLaborDen > 0 ? Math.round((wkLaborNum / wkLaborDen) * 10) / 10 : 0);
          total.budget.push(roundCents(wkBudget));

          // Aggregate L2 units across all stores for this week
          const wkL2 = {};
          for (const s of scopedStoresT13) {
            for (const [cat, qty] of Object.entries(perStoreL2[s] || {})) {
              wkL2[cat] = (wkL2[cat] || 0) + qty;
            }
          }
          l2UnitsByWeek.push(wkL2);

          // Aggregate L2 net sales across all stores for this week
          const wkL2Net = {};
          for (const s of scopedStoresT13) {
            for (const [cat, net] of Object.entries(perStoreL2Net[s] || {})) {
              wkL2Net[cat] = (wkL2Net[cat] || 0) + net;
            }
          }
          l2NetByWeek.push(Object.fromEntries(Object.entries(wkL2Net).map(([k, v]) => [k, roundCents(v)])));

          perStoreL2UnitsByWeek.push({ ...perStoreL2 });
          perStoreL2NetByWeek.push(
            Object.fromEntries(Object.entries(perStoreL2Net).map(([s, cats]) =>
              [s, Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, roundCents(v)]))]
            ))
          );
        }

        if (liveBuilds > 0) {
          console.warn(`weekly-t13: ${liveBuilds} live aggregations (consider running ?action=rebuild-week-summaries)`);
        }

        return new Response(JSON.stringify({
          weeks: weeks.map(w => w.week),
          dates: weeks,
          stores,
          total,
          l2Units: l2UnitsByWeek,
          l2Net: l2NetByWeek,
          perStoreL2Units: perStoreL2UnitsByWeek,
          perStoreL2Net: perStoreL2NetByWeek,
          liveBuilds,
        }), { headers: corsJson });
      } catch (err) {
        return new Response(JSON.stringify({ error: "weekly-t13 failed", detail: err.message }), { status: 500, headers: corsJson });
      }
    }

    // ── Admin: client-date probe (READ-ONLY, no D1/KV writes) ─────────
    //    GET ?action=clientdate-probe&store=BL14&start=YYYY-MM-DD&end=YYYY-MM-DD[&buffer=2]
    // Recovers correct per-day sales after an offline / late-sync event. The
    // normal pipeline buckets by Clover createdTime (server receipt time); when
    // a register runs offline its orders only reach Clover on sync, so they land
    // on the wrong day. This re-buckets by clientCreatedTime (the register's
    // local clock = actual sale time) and reports per-day totals using the same
    // category-based derivation the nightly snapshot uses for D1. Paste the
    // target-range rows into the Manual Sales Override tool.
    if (url.searchParams.get("action") === "clientdate-probe") {
      const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
      const unauth = requireAdminSecret(request, env, corsJson);
      if (unauth) return unauth;

      const store = (url.searchParams.get("store") || "").toUpperCase();
      const start = url.searchParams.get("start") || "";
      const end = url.searchParams.get("end") || start;
      const buffer = Math.max(0, Math.min(7, parseInt(url.searchParams.get("buffer") || "2", 10)));
      if (!store || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
        return new Response(JSON.stringify({ error: "need store, start=YYYY-MM-DD, end=YYYY-MM-DD" }), { status: 400, headers: corsJson });
      }

      const etDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms));
      const addDays = (dateStr, n) => { const d = new Date(dateStr + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

      // Wide createdTime fetch window so late-synced orders are caught:
      // [start 00:00 ET, (end + buffer + 1) 00:00 ET).
      const since = getStartOfDayET(start);
      const until = getStartOfDayET(addDays(end, buffer + 1));

      const [elements, itemCatMap, overrides, itemCosts] = await Promise.all([
        fetchItemOrders(store, env, since, until),
        fetchItemCategoryMap(store, env),
        fetchItemOverrides(env),
        fetchItemCosts(env),
      ]);
      if (!elements) {
        return new Response(JSON.stringify({ error: `store ${store} not configured or Clover fetch failed` }), { status: 500, headers: corsJson });
      }
      // Refunds reported as a single window total (not per-day) so this stays a
      // simple, double-count-free read. Per-day figures below are GROSS of refunds.
      let windowRefunds = 0;
      try { windowRefunds = (await fetchRefundsTotal(store, env, since, until, null)) / 100; } catch (_) {}

      // Bucket each order by ET day of clientCreatedTime (fallback createdTime).
      const buckets = {};
      let lateSync = 0;
      for (const o of elements) {
        const cct = (o.clientCreatedTime != null) ? o.clientCreatedTime : o.createdTime;
        const cDay = etDay(cct);
        if (etDay(o.createdTime) !== cDay) lateSync++;
        (buckets[cDay] = buckets[cDay] || []).push(o);
      }

      // Per-day category-based totals (same derivation as the nightly snapshot:
      // total = sum of category netSales; bin = "Bin Products"; retail = rest).
      const days = [];
      for (let d = start; d <= addDays(end, buffer); d = addDays(d, 1)) {
        const bucket = buckets[d] || [];
        let total = 0, bin = 0, retail = 0;
        if (bucket.length) {
          const agg = aggregateItemSales(bucket, itemCatMap, store, d, overrides, itemCosts, [], [], []);
          for (const c of (agg.categories || [])) {
            if (c.category === "Bin Products") bin += c.netSales; else retail += c.netSales;
          }
          total = agg.totals?.netSales || 0;
        }
        days.push({
          date: d,
          inTargetRange: d >= start && d <= end,
          orderCount: bucket.length,
          total: +total.toFixed(2),
          retail: +retail.toFixed(2),
          bin: +bin.toFixed(2),
        });
      }

      return new Response(JSON.stringify({
        store, start, end, buffer,
        bucketedBy: "clientCreatedTime (fallback createdTime)",
        totalOrdersInWindow: elements.length,
        lateSyncOrders: lateSync,
        windowRefundsTotal: +windowRefunds.toFixed(2),
        note: "Per-day totals are GROSS of refunds (windowRefundsTotal shown separately). Paste inTargetRange rows into Manual Sales Override.",
        days,
      }, null, 2), { headers: corsJson });
    }

    // ── Admin: re-snapshot day(s) bucketed by clientCreatedTime ───────
    //    POST/GET ?action=resnapshot-clienttime&store=BL14|all&start=YYYY-MM-DD&end=YYYY-MM-DD[&look=3]
    // The durable fix for offline / late-sync days: re-writes daily_sales (and
    // the item-sales snapshot) for each day in [start,end] using actual sale
    // time (clientCreatedTime) instead of Clover receipt time. Manual-override
    // rows are preserved (skipped). Admin-secret gated. WRITES to D1/KV.
    if (url.searchParams.get("action") === "resnapshot-clienttime") {
      const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
      const unauth = requireAdminSecret(request, env, corsJson);
      if (unauth) return unauth;

      const storeParam = (url.searchParams.get("store") || "").toUpperCase();
      const start = url.searchParams.get("start") || "";
      const end = url.searchParams.get("end") || start;
      const look = Math.max(0, Math.min(7, parseInt(url.searchParams.get("look") || "3", 10)));
      if (!storeParam || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
        return new Response(JSON.stringify({ error: "need store (or 'all'), start=YYYY-MM-DD, end=YYYY-MM-DD" }), { status: 400, headers: corsJson });
      }
      const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
      const stores = storeParam === "ALL" ? ALL_STORES : [storeParam];
      const results = [];
      for (const store of stores) {
        for (let d = start; d <= end; d = addDays(d, 1)) {
          try {
            const r = await snapshotDayByClientTime(store, env, d, look);
            results.push({
              store, date: d,
              status: r ? (r.skippedManualOverride ? "skipped: manual override"
                          : r.skippedZeroOverwrite ? "skipped: zero/negative guard" : "ok")
                        : "skipped: no creds / fetch failed",
              total: r?.total ?? null, retail: r?.retail ?? null, bin: r?.bin ?? null,
              bucketOrders: r?.bucketOrders ?? null,
            });
          } catch (e) {
            results.push({ store, date: d, status: `error: ${e.message}` });
          }
        }
      }
      return new Response(JSON.stringify({ ok: true, look, count: results.length, results }, null, 2), { headers: corsJson });
    }

    // ── Admin: manual override for daily_sales rows.
    //    POST  ?action=manual-override
    //    body: { entries: [ { store, date, total?, retail?, bin?, auction?, labor_pct?, labor_hours? } ] }
    // Single-entry: pass one element. Bulk: pass many. At least one numeric
    // field per entry must be provided. Sets is_manual_override=1 so the
    // cron snapshot and Sheet backfill will not overwrite this row.
    if (url.searchParams.get("action") === "manual-override") {
      const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
      const unauth = requireAdminSecret(request, env, corsJson);
      if (unauth) return unauth;
      if (!env.DB) {
        return new Response(JSON.stringify({ error: "DB not configured" }), { status: 500, headers: corsJson });
      }
      let body = {};
      try { body = await request.json(); } catch {}
      const entries = Array.isArray(body.entries) ? body.entries : (body.store && body.date ? [body] : []);
      if (!entries.length) {
        return new Response(JSON.stringify({ error: "No entries provided. Send { entries: [...] } or a single object." }), { status: 400, headers: corsJson });
      }
      // When true, rows that already have is_manual_override=1 are left untouched.
      // Used by the daily-CSV import flow to avoid clobbering hand-entered values.
      const skipIfOverrideExists = !!body.skipIfOverrideExists;

      const num = (v) => (v === '' || v == null ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
      const FIELDS = ['total', 'retail', 'bin', 'auction', 'labor_pct', 'labor_hours'];
      const results = [];
      for (const e of entries) {
        const store = (e.store || '').toUpperCase();
        const date = e.date || '';
        if (!store || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          results.push({ store, date, error: 'invalid store/date' });
          continue;
        }
        // Skip rows that are already manual overrides when the caller asks for it.
        if (skipIfOverrideExists) {
          try {
            const existing = await env.DB.prepare(
              "SELECT is_manual_override FROM daily_sales WHERE store = ? AND date = ?"
            ).bind(store, date).first();
            if (existing?.is_manual_override) {
              results.push({ store, date, skipped: true, reason: 'existing manual override preserved' });
              continue;
            }
          } catch {}
        }
        // Build the SET list dynamically from provided fields only.
        const updates = {};
        for (const f of FIELDS) {
          if (e[f] !== undefined) {
            const v = num(e[f]);
            if (v !== null) updates[f] = v;
          }
        }
        if (!Object.keys(updates).length) {
          results.push({ store, date, error: 'no numeric fields provided' });
          continue;
        }

        // Derive week label from date if D1 has nothing (so T13 can find it).
        const wk = e.week ? String(e.week) : null;
        const setCols = Object.keys(updates);
        const colList = setCols.join(', ');
        const placeholders = setCols.map(() => '?').join(', ');
        const updateList = setCols.map((c) => `${c}=excluded.${c}`).join(', ');
        const values = setCols.map((c) => updates[c]);
        const snapshotTime = new Date().toISOString();

        try {
          await env.DB.prepare(
            `INSERT INTO daily_sales (store, date, week, ${colList}, snapshot_time, is_manual_override)
             VALUES (?, ?, ?, ${placeholders}, ?, 1)
             ON CONFLICT(store, date) DO UPDATE SET
               ${updateList},
               week=COALESCE(excluded.week, week),
               snapshot_time=excluded.snapshot_time,
               is_manual_override=1`
          ).bind(store, date, wk, ...values, snapshotTime).run();
          results.push({ store, date, ok: true, fields: updates });
        } catch (err) {
          results.push({ store, date, error: err.message });
        }
      }

      // Auto-rebuild week summaries for the affected weeks so T13 reflects the change.
      const affectedWeeks = new Set();
      for (const r of results) {
        if (!r.ok) continue;
        const year = r.date.slice(0, 4);
        try {
          const row = await env.DB.prepare(
            "SELECT DISTINCT week FROM daily_sales WHERE date = ? AND week IS NOT NULL LIMIT 1"
          ).bind(r.date).first();
          if (row?.week) affectedWeeks.add(`${row.week}|${year}`);
        } catch {}
      }
      const rebuildResults = [];
      for (const key of affectedWeeks) {
        const [wk, year] = key.split('|');
        const settled = await Promise.allSettled(
          ALL_STORES.map(s => writeWeekSummary(env, s, wk, year))
        );
        rebuildResults.push({ week: wk, year, written: settled.filter(s => s.status === 'fulfilled' && s.value).length });
      }

      const ok = results.filter(r => r.ok).length;
      return new Response(JSON.stringify({ ok: true, count: ok, total: results.length, results, rebuilt: rebuildResults }), { headers: corsJson });
    }

    // ── Push notifications ────────────────────────────────────────────────────
    // Return the VAPID public key so the client can subscribe.
    // GET ?action=vapid-public-key  (no auth required — it's a public key)
    if (url.searchParams.get("action") === "vapid-public-key") {
      if (!env.VAPID_PUBLIC_KEY) {
        return new Response(JSON.stringify({ error: "Push not configured" }), { status: 500, headers: corsJson });
      }
      return new Response(JSON.stringify({ ok: true, publicKey: env.VAPID_PUBLIC_KEY }), { headers: corsJson });
    }

    // POST ?action=push-subscribe  { endpoint, p256dh, auth, userAgent? }
    // Saves a push subscription for the authenticated user (5-device cap).
    if (request.method === "POST" && url.searchParams.get("action") === "push-subscribe") {
      if (!currentUser) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsJson });
      try {
        const { endpoint, p256dh, auth, userAgent } = await request.json();
        if (!endpoint || !p256dh || !auth) {
          return new Response(JSON.stringify({ error: "Missing endpoint/p256dh/auth" }), { status: 400, headers: corsJson });
        }
        const DEVICE_CAP = 5;
        const { results: existing } = await env.DB.prepare(
          "SELECT id FROM push_subscriptions WHERE user_id = ?"
        ).bind(currentUser.id).all();
        // If this exact endpoint already exists for this user, it's a re-subscribe — just update
        const { results: sameEndpoint } = await env.DB.prepare(
          "SELECT id FROM push_subscriptions WHERE endpoint = ?"
        ).bind(endpoint).all();
        if (!sameEndpoint?.length && (existing?.length || 0) >= DEVICE_CAP) {
          return new Response(JSON.stringify({ error: `Device cap reached (max ${DEVICE_CAP})` }), { status: 409, headers: corsJson });
        }
        const id = randomHex(16);
        const now = new Date().toISOString();
        await env.DB.prepare(`
          INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(endpoint) DO UPDATE SET
            user_id    = excluded.user_id,
            p256dh     = excluded.p256dh,
            auth       = excluded.auth,
            user_agent = excluded.user_agent,
            created_at = excluded.created_at
        `).bind(id, currentUser.id, endpoint, p256dh, auth, userAgent || null, now).run();
        // Ensure a notification_preferences row exists
        await env.DB.prepare(`
          INSERT INTO notification_preferences (user_id, push_enabled, daily_summary, updated_at)
          VALUES (?, 1, 1, ?)
          ON CONFLICT(user_id) DO NOTHING
        `).bind(currentUser.id, now).run();
        return new Response(JSON.stringify({ ok: true }), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

    // POST ?action=push-unsubscribe  { endpoint }
    // Removes a push subscription for the authenticated user.
    if (request.method === "POST" && url.searchParams.get("action") === "push-unsubscribe") {
      if (!currentUser) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsJson });
      try {
        const { endpoint } = await request.json();
        if (!endpoint) return new Response(JSON.stringify({ error: "Missing endpoint" }), { status: 400, headers: corsJson });
        await env.DB.prepare(
          "DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?"
        ).bind(endpoint, currentUser.id).run();
        return new Response(JSON.stringify({ ok: true }), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

    // GET ?action=push-subscription-status
    // Returns whether the current user has any push subscriptions.
    if (url.searchParams.get("action") === "push-subscription-status") {
      if (!currentUser) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsJson });
      try {
        const [subRow, prefRow] = await Promise.all([
          env.DB.prepare("SELECT COUNT(*) AS cnt FROM push_subscriptions WHERE user_id = ?").bind(currentUser.id).first(),
          env.DB.prepare("SELECT push_enabled, daily_summary, weekly_digest, interval_summary, supply_notifications FROM notification_preferences WHERE user_id = ?").bind(currentUser.id).first(),
        ]);
        const cnt = subRow?.cnt ?? 0;
        const dailySummary       = prefRow ? !!prefRow.daily_summary       : true;
        const weeklyDigest       = prefRow ? !!prefRow.weekly_digest       : true;
        const intervalSummary    = prefRow?.interval_summary               ?? 'off';
        const supplyNotifications = prefRow ? !!prefRow.supply_notifications : true;
        return new Response(JSON.stringify({ ok: true, deviceCount: cnt, maxDevices: 5, dailySummary, weeklyDigest, intervalSummary, supplyNotifications }), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

        // GET/POST ?action=test-interval-summary  (admin secret)
    // Fires dispatchIntervalSummary on demand so the v3 notification format
    // can be verified without waiting for the top-of-hour cron.
    if (url.searchParams.get("action") === "test-interval-summary") {
      const unauth = requireAdminSecret(request, env, corsJson);
      if (unauth) return unauth;
      try {
        const result = await dispatchIntervalSummary(env);
        return new Response(JSON.stringify({ ok: true, result }, null, 2), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: "dispatch failed", detail: e.message }), { status: 500, headers: corsJson });
      }
    }

    // POST ?action=push-test
    // Sends a test push notification to all of the current user's subscriptions.
    if (request.method === "POST" && url.searchParams.get("action") === "push-test") {
      if (!currentUser) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsJson });
      if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
        return new Response(JSON.stringify({ error: "Push not configured on server" }), { status: 500, headers: corsJson });
      }
      try {
        const { results: subs } = await env.DB.prepare(
          "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?"
        ).bind(currentUser.id).all();
        if (!subs?.length) {
          return new Response(JSON.stringify({ ok: false, error: "No subscriptions found for this user" }), { status: 404, headers: corsJson });
        }
        const payload = JSON.stringify({
          title: 'Bargain Lane Dashboard',
          body: 'Test notification — push is working! ✅',
          tag: 'test',
        });
        let sent = 0, failed = 0, expired = 0;
        for (const sub of subs) {
          try {
            const result = await sendWebPush(env, sub, payload);
            if (result.expired) {
              expired++;
              await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(sub.endpoint).run();
            } else {
              sent++;
            }
          } catch (e) {
            failed++;
            console.error(`push-test failed for ${sub.endpoint}: ${e.message}`);
          }
        }
        const logId = randomHex(16);
        await env.DB.prepare(
          "INSERT INTO notification_log (id, user_id, type, event_type, status, created_at) VALUES (?, ?, 'push', 'test', ?, ?)"
        ).bind(logId, currentUser.id, failed ? 'failed' : 'sent', new Date().toISOString()).run().catch(() => {});
        return new Response(JSON.stringify({ ok: true, sent, failed, expired }), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

    // POST ?action=update-notif-prefs  { push_enabled?, daily_summary?, weekly_digest?, interval_summary? }
    // Updates notification_preferences for the authenticated user.
    if (request.method === "POST" && url.searchParams.get("action") === "update-notif-prefs") {
      if (!currentUser) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsJson });
      try {
        const body = await request.json();
        const fields = {};
        if (typeof body.push_enabled   === 'boolean') fields.push_enabled   = body.push_enabled   ? 1 : 0;
        if (typeof body.daily_summary  === 'boolean') fields.daily_summary  = body.daily_summary  ? 1 : 0;
        if (typeof body.weekly_digest  === 'boolean') fields.weekly_digest  = body.weekly_digest  ? 1 : 0;
        if (['off', '1h', '3h'].includes(body.interval_summary)) fields.interval_summary = body.interval_summary;
        if (typeof body.supply_notifications === 'boolean') fields.supply_notifications = body.supply_notifications ? 1 : 0;
        if (!Object.keys(fields).length) return new Response(JSON.stringify({ error: "Nothing to update" }), { status: 400, headers: corsJson });
        const now = new Date().toISOString();
        const setClauses = Object.keys(fields).map(k => `${k} = ?`).join(', ');
        await env.DB.prepare(
          `INSERT INTO notification_preferences (user_id, push_enabled, daily_summary, updated_at) VALUES (?, 1, 1, ?)
           ON CONFLICT(user_id) DO UPDATE SET ${setClauses}, updated_at = ?`
        ).bind(currentUser.id, now, ...Object.values(fields), now).run();
        return new Response(JSON.stringify({ ok: true }), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

    // POST ?action=send-daily-summary[&date=YYYY-MM-DD]
    // Manually trigger the daily summary dispatch (superuser or admin-secret).
    if (request.method === "POST" && url.searchParams.get("action") === "send-daily-summary") {
      const isAdminReq = request.headers.get('X-Snapshot-Secret') === env.SNAPSHOT_SECRET;
      if (!isAdminReq && (!currentUser || currentUser.role !== 'superuser')) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsJson });
      }
      const dateParam = url.searchParams.get("date") || (() => {
        const y = new Date(); y.setUTCDate(y.getUTCDate() - 1);
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(y);
      })();
      try {
        const result = await dispatchDailySummary(env, dateParam);
        return new Response(JSON.stringify(result), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

    // POST ?action=send-weekly-digest[&start=YYYY-MM-DD&end=YYYY-MM-DD]
    // Manually trigger the weekly digest (superuser or admin-secret).
    if (request.method === "POST" && url.searchParams.get("action") === "send-weekly-digest") {
      const isAdminReq = request.headers.get('X-Snapshot-Secret') === env.SNAPSHOT_SECRET;
      if (!isAdminReq && (!currentUser || currentUser.role !== 'superuser')) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsJson });
      }
      // Default: last Mon–Sun
      const endD   = new Date(Date.now() - 24 * 3600 * 1000);
      const startD = new Date(endD.getTime() - 6 * 24 * 3600 * 1000);
      const etFmt  = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
      const startDate = url.searchParams.get("start") || etFmt(startD);
      const endDate   = url.searchParams.get("end")   || etFmt(endD);
      try {
        const result = await dispatchWeeklyDigest(env, startDate, endDate);
        return new Response(JSON.stringify(result), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

    // ── Supply Request endpoints ──────────────────────────────────────────────

    // POST ?action=supply-request-create
    // Body: { store, items: [{category,item_name,quantity,unit,notes}], notes?, priority? }
    // Any authenticated user may submit; managers/DMs restricted to their allowed stores.
    if (request.method === "POST" && url.searchParams.get("action") === "supply-request-create") {
      if (!currentUser) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsJson });
      try {
        const body = await request.json();
        const { store, items, notes, priority = 'normal' } = body;
        if (!store || !Array.isArray(items) || !items.length) {
          return new Response(JSON.stringify({ error: "store and at least one item required" }), { status: 400, headers: corsJson });
        }
        // Validate store access
        const allowed = allowedStores(currentUser);
        if (allowed !== null && !allowed.includes(store)) {
          return new Response(JSON.stringify({ error: "Store not permitted" }), { status: 403, headers: corsJson });
        }
        if (!['normal','urgent'].includes(priority)) {
          return new Response(JSON.stringify({ error: "Invalid priority" }), { status: 400, headers: corsJson });
        }
        const VALID_CATEGORIES = ['Cleaning','Office','Fixtures','Safety','Other'];
        for (const it of items) {
          if (!it.item_name?.trim()) return new Response(JSON.stringify({ error: "Each item requires item_name" }), { status: 400, headers: corsJson });
          if (!VALID_CATEGORIES.includes(it.category)) it.category = 'Other';
        }
        const now = new Date().toISOString();
        const requestId = randomHex(16);

        // Insert request
        await env.DB.prepare(
          `INSERT INTO supply_requests (id, user_id, user_email, store, status, priority, notes, submitted_at, updated_at)
           VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
        ).bind(requestId, currentUser.id, currentUser.email, store, priority, notes || null, now, now).run();

        // Insert items
        const itemStmts = items.map(it =>
          env.DB.prepare(
            `INSERT INTO supply_request_items (id, request_id, category, item_name, quantity, unit, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(randomHex(12), requestId, it.category || 'Other', it.item_name.trim(),
                 it.quantity || 1, it.unit || 'units', it.notes || null)
        );
        await env.DB.batch(itemStmts);

        // Initial history entry
        await env.DB.prepare(
          `INSERT INTO supply_request_history (id, request_id, type, changed_by_id, changed_by_email, old_status, new_status, note, changed_at)
           VALUES (?, ?, 'status_change', ?, ?, null, 'pending', 'Request submitted', ?)`
        ).bind(randomHex(12), requestId, currentUser.id, currentUser.email, now).run();

        // Notify superusers (fire-and-forget)
        const fullItems = await env.DB.prepare('SELECT * FROM supply_request_items WHERE request_id = ?').bind(requestId).all();
        ctx.waitUntil(notifySupplyRequestNew(env, {
          requestId, requesterId: currentUser.id, requesterEmail: currentUser.email,
          store, priority, notes: notes || '', items: fullItems.results || [],
        }));

        return new Response(JSON.stringify({ ok: true, id: requestId }), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

    // GET ?action=supply-requests[&store=BL1][&status=pending][&limit=50][&offset=0]
    // Superuser/admin: all requests. Others: own store(s) only.
    if (request.method === "GET" && url.searchParams.get("action") === "supply-requests") {
      if (!currentUser) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsJson });
      try {
        const filterStore  = url.searchParams.get("store") || null;
        const filterStatus = url.searchParams.get("status") || null;
        const limit  = Math.min(parseInt(url.searchParams.get("limit")  || "100", 10), 200);
        const offset = parseInt(url.searchParams.get("offset") || "0", 10);

        const allowed = allowedStores(currentUser); // null = all stores
        const conditions = [];
        const binds = [];

        if (allowed !== null) {
          // Restrict to user's own requests for their stores
          if (allowed.length === 0) {
            return new Response(JSON.stringify({ ok: true, requests: [], total: 0 }), { headers: corsJson });
          }
          conditions.push(`r.store IN (${allowed.map(() => '?').join(',')})`);
          binds.push(...allowed);
        }
        if (filterStore) { conditions.push('r.store = ?'); binds.push(filterStore); }
        if (filterStatus) { conditions.push('r.status = ?'); binds.push(filterStatus); }

        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const rows = await env.DB.prepare(
          `SELECT r.id, r.user_email, r.store, r.status, r.priority, r.invoice_number,
                  r.cost, r.notes, r.submitted_at, r.updated_at,
                  (SELECT COUNT(*) FROM supply_request_items WHERE request_id = r.id) AS item_count
           FROM supply_requests r
           ${where}
           ORDER BY
             CASE r.priority WHEN 'urgent' THEN 0 ELSE 1 END,
             r.submitted_at DESC
           LIMIT ? OFFSET ?`
        ).bind(...binds, limit, offset).all();

        const countRow = await env.DB.prepare(
          `SELECT COUNT(*) AS total FROM supply_requests r ${where}`
        ).bind(...binds).first();

        return new Response(JSON.stringify({ ok: true, requests: rows.results || [], total: countRow?.total ?? 0 }), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

    // GET ?action=supply-request&id=xxx
    // Returns full request: items array + history array.
    if (request.method === "GET" && url.searchParams.get("action") === "supply-request") {
      if (!currentUser) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsJson });
      try {
        const id = url.searchParams.get("id");
        if (!id) return new Response(JSON.stringify({ error: "Missing id" }), { status: 400, headers: corsJson });

        const req = await env.DB.prepare('SELECT * FROM supply_requests WHERE id = ?').bind(id).first();
        if (!req) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: corsJson });

        // Access check: non-superusers can only see requests for their stores
        const allowed = allowedStores(currentUser);
        if (allowed !== null && !allowed.includes(req.store)) {
          return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsJson });
        }

        const [{ results: items }, { results: history }] = await Promise.all([
          env.DB.prepare('SELECT * FROM supply_request_items WHERE request_id = ? ORDER BY rowid').bind(id).all(),
          env.DB.prepare('SELECT * FROM supply_request_history WHERE request_id = ? ORDER BY changed_at ASC').bind(id).all(),
        ]);

        return new Response(JSON.stringify({ ok: true, request: { ...req, items: items || [], history: history || [] } }), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

    // PATCH ?action=supply-request-status
    // Body: { id, status, note? }  — superuser only.
    if (request.method === "PATCH" && url.searchParams.get("action") === "supply-request-status") {
      if (!currentUser || currentUser.role !== 'superuser') {
        return new Response(JSON.stringify({ error: "Superuser required" }), { status: 403, headers: corsJson });
      }
      try {
        const { id, status, note } = await request.json();
        const VALID = ['pending','under_review','on_hold','ordered'];
        if (!id || !VALID.includes(status)) {
          return new Response(JSON.stringify({ error: "id and valid status required" }), { status: 400, headers: corsJson });
        }
        const existing = await env.DB.prepare('SELECT * FROM supply_requests WHERE id = ?').bind(id).first();
        if (!existing) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: corsJson });
        if (existing.status === status) return new Response(JSON.stringify({ ok: true, unchanged: true }), { headers: corsJson });

        const now = new Date().toISOString();
        await env.DB.prepare(
          'UPDATE supply_requests SET status = ?, updated_at = ? WHERE id = ?'
        ).bind(status, now, id).run();

        await env.DB.prepare(
          `INSERT INTO supply_request_history (id, request_id, type, changed_by_id, changed_by_email, old_status, new_status, note, changed_at)
           VALUES (?, ?, 'status_change', ?, ?, ?, ?, ?, ?)`
        ).bind(randomHex(12), id, currentUser.id, currentUser.email, existing.status, status, note || null, now).run();

        // Notify requester
        ctx.waitUntil(notifySupplyStatusChange(env, {
          requestId: id,
          requesterId: existing.user_id,
          requesterEmail: existing.user_email,
          store: existing.store,
          oldStatus: existing.status,
          newStatus: status,
          note: note || '',
        }));

        return new Response(JSON.stringify({ ok: true }), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

    // PATCH ?action=supply-request-fulfillment
    // Body: { id, invoice_number?, cost?, note? }  — superuser only.
    // Setting cost deducts from store's monthly budget and may trigger 80% alert.
    if (request.method === "PATCH" && url.searchParams.get("action") === "supply-request-fulfillment") {
      if (!currentUser || currentUser.role !== 'superuser') {
        return new Response(JSON.stringify({ error: "Superuser required" }), { status: 403, headers: corsJson });
      }
      try {
        const { id, invoice_number, cost, note } = await request.json();
        if (!id) return new Response(JSON.stringify({ error: "Missing id" }), { status: 400, headers: corsJson });

        const existing = await env.DB.prepare('SELECT * FROM supply_requests WHERE id = ?').bind(id).first();
        if (!existing) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: corsJson });

        const updates = [];
        const binds = [];
        if (invoice_number !== undefined) { updates.push('invoice_number = ?'); binds.push(invoice_number); }
        if (cost !== undefined)           { updates.push('cost = ?');           binds.push(cost); }
        if (!updates.length) return new Response(JSON.stringify({ error: "Nothing to update" }), { status: 400, headers: corsJson });

        const now = new Date().toISOString();
        updates.push('updated_at = ?'); binds.push(now);
        binds.push(id);
        await env.DB.prepare(`UPDATE supply_requests SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();

        if (note) {
          await env.DB.prepare(
            `INSERT INTO supply_request_history (id, request_id, type, changed_by_id, changed_by_email, note, changed_at)
             VALUES (?, ?, 'comment', ?, ?, ?, ?)`
          ).bind(randomHex(12), id, currentUser.id, currentUser.email, note, now).run();
        }

        // Budget threshold check when cost is set
        if (cost != null) {
          const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
          const year = etNow.getFullYear();
          const month = etNow.getMonth() + 1;
          const budgetRow = await env.DB.prepare(
            'SELECT budget FROM supply_budgets WHERE store = ? AND year = ? AND month = ?'
          ).bind(existing.store, year, month).first();

          if (budgetRow?.budget > 0) {
            const spentRow = await env.DB.prepare(
              `SELECT COALESCE(SUM(cost),0) AS spent FROM supply_requests
               WHERE store = ? AND status = 'ordered' AND cost IS NOT NULL
               AND strftime('%Y', submitted_at) = ? AND strftime('%m', submitted_at) = ?`
            ).bind(existing.store, String(year), String(month).padStart(2,'0')).first();
            const prevCost = existing.cost || 0;
            const prevSpent = (spentRow?.spent || 0) - cost + prevCost; // before this update
            const newSpent  = (spentRow?.spent || 0);
            const pct = budgetRow.budget > 0 ? newSpent / budgetRow.budget : 0;
            const prevPct = budgetRow.budget > 0 ? prevSpent / budgetRow.budget : 0;
            // Fire alert only when crossing 80% threshold
            if (pct >= 0.8 && prevPct < 0.8) {
              ctx.waitUntil(notifySupplyBudget80(env, {
                store: existing.store, year, month, budget: budgetRow.budget, spent: newSpent,
              }));
            }
          }
        }

        return new Response(JSON.stringify({ ok: true }), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

    // GET ?action=supply-budgets[&year=2026][&month=5]
    // Returns budget + spent for each store. Managers see only their stores.
    if (request.method === "GET" && url.searchParams.get("action") === "supply-budgets") {
      if (!currentUser) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsJson });
      try {
        const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const year  = parseInt(url.searchParams.get("year")  || String(etNow.getFullYear()), 10);
        const month = parseInt(url.searchParams.get("month") || String(etNow.getMonth() + 1), 10);

        const allowed = allowedStores(currentUser); // null = all
        const storeList = allowed === null ? ALL_STORES : ALL_STORES.filter(s => allowed.includes(s));

        const monthStr = String(month).padStart(2, '0');
        const yearStr  = String(year);

        const budgets = await Promise.all(storeList.map(async store => {
          const budgetRow = await env.DB.prepare(
            'SELECT budget FROM supply_budgets WHERE store = ? AND year = ? AND month = ?'
          ).bind(store, year, month).first();

          const spentRow = await env.DB.prepare(
            `SELECT COALESCE(SUM(cost), 0) AS spent FROM supply_requests
             WHERE store = ? AND status = 'ordered' AND cost IS NOT NULL
             AND strftime('%Y', submitted_at) = ? AND strftime('%m', submitted_at) = ?`
          ).bind(store, yearStr, monthStr).first();

          const budget = budgetRow?.budget ?? 0;
          const spent  = spentRow?.spent  ?? 0;
          return { store, label: STORE_LABELS[store] || store, budget, spent, remaining: budget - spent };
        }));

        return new Response(JSON.stringify({ ok: true, year, month, budgets }), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

    // POST ?action=supply-budget-set
    // Body: { store, year, month, budget }  — superuser only.
    if (request.method === "POST" && url.searchParams.get("action") === "supply-budget-set") {
      if (!currentUser || currentUser.role !== 'superuser') {
        return new Response(JSON.stringify({ error: "Superuser required" }), { status: 403, headers: corsJson });
      }
      try {
        const { store, year, month, budget } = await request.json();
        if (!store || !year || !month || budget == null) {
          return new Response(JSON.stringify({ error: "store, year, month, budget required" }), { status: 400, headers: corsJson });
        }
        if (!ALL_STORES.includes(store)) {
          return new Response(JSON.stringify({ error: "Invalid store" }), { status: 400, headers: corsJson });
        }
        await env.DB.prepare(
          `INSERT INTO supply_budgets (store, year, month, budget) VALUES (?, ?, ?, ?)
           ON CONFLICT(store, year, month) DO UPDATE SET budget = excluded.budget`
        ).bind(store, year, month, budget).run();
        return new Response(JSON.stringify({ ok: true }), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

    // GET ?action=supply-budgets-all  — superuser only. Returns all supply_budgets rows.
    if (request.method === "GET" && url.searchParams.get("action") === "supply-budgets-all") {
      if (!currentUser || currentUser.role !== 'superuser') {
        return new Response(JSON.stringify({ error: "Superuser required" }), { status: 403, headers: corsJson });
      }
      try {
        const { results: budgets } = await env.DB.prepare(
          `SELECT store, year, month, budget FROM supply_budgets ORDER BY year DESC, month DESC, store`
        ).all();
        return new Response(JSON.stringify({ ok: true, budgets }), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

    // ── "What's New" announcement (superuser authors; all users see) ──
    // Stored as a single KV JSON blob. Bumping it (new id) re-shows the
    // popup for everyone, even users who dismissed the previous one.
    // GET ?action=announcement  — any authenticated user.
    if (request.method === "GET" && url.searchParams.get("action") === "announcement") {
      if (!currentUser) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsJson });
      try {
        const a = env.SALES_SNAPSHOTS ? await env.SALES_SNAPSHOTS.get("announcement:current", "json") : null;
        return new Response(JSON.stringify({ ok: true, announcement: a || null }), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

    // POST ?action=announcement-set  — superuser only.
    // Body: { title, items: [{ t, d }] }  → saved as the current announcement.
    if (request.method === "POST" && url.searchParams.get("action") === "announcement-set") {
      if (!currentUser || currentUser.role !== 'superuser') {
        return new Response(JSON.stringify({ error: "Superuser required" }), { status: 403, headers: corsJson });
      }
      if (!env.SALES_SNAPSHOTS) return new Response(JSON.stringify({ error: "Storage unavailable" }), { status: 503, headers: corsJson });
      try {
        const body = await request.json();
        const title = String(body.title || "").trim().slice(0, 120);
        const items = Array.isArray(body.items) ? body.items
          .map(it => ({ t: String(it.t || "").trim().slice(0, 120), d: String(it.d || "").trim().slice(0, 240) }))
          .filter(it => it.t).slice(0, 12) : [];
        if (!title && items.length === 0) {
          return new Response(JSON.stringify({ error: "Title or at least one item required" }), { status: 400, headers: corsJson });
        }
        const announcement = { id: String(Date.now()), title, items, createdAt: new Date().toISOString(), createdBy: currentUser.email || currentUser.id || "superuser" };
        await env.SALES_SNAPSHOTS.put("announcement:current", JSON.stringify(announcement));
        return new Response(JSON.stringify({ ok: true, announcement }), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

    // POST ?action=announcement-clear  — superuser only. Removes the popup.
    if (request.method === "POST" && url.searchParams.get("action") === "announcement-clear") {
      if (!currentUser || currentUser.role !== 'superuser') {
        return new Response(JSON.stringify({ error: "Superuser required" }), { status: 403, headers: corsJson });
      }
      try {
        if (env.SALES_SNAPSHOTS) await env.SALES_SNAPSHOTS.delete("announcement:current");
        return new Response(JSON.stringify({ ok: true }), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

    // DELETE ?action=supply-request-delete
    // Body: { id }  — superuser only. Cascades to items + history via FK.
    if (request.method === "DELETE" && url.searchParams.get("action") === "supply-request-delete") {
      if (!currentUser || currentUser.role !== 'superuser') {
        return new Response(JSON.stringify({ error: "Superuser required" }), { status: 403, headers: corsJson });
      }
      try {
        const { id } = await request.json();
        if (!id) return new Response(JSON.stringify({ error: "Missing id" }), { status: 400, headers: corsJson });
        const existing = await env.DB.prepare('SELECT id FROM supply_requests WHERE id = ?').bind(id).first();
        if (!existing) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: corsJson });
        await env.DB.prepare('DELETE FROM supply_requests WHERE id = ?').bind(id).run();
        return new Response(JSON.stringify({ ok: true }), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

    // POST ?action=supply-request-comment
    // Body: { id, note }  — any authenticated user (superuser or requester's store).
    if (request.method === "POST" && url.searchParams.get("action") === "supply-request-comment") {
      if (!currentUser) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsJson });
      try {
        const { id, note } = await request.json();
        if (!id || !note?.trim()) return new Response(JSON.stringify({ error: "id and note required" }), { status: 400, headers: corsJson });

        const existing = await env.DB.prepare('SELECT * FROM supply_requests WHERE id = ?').bind(id).first();
        if (!existing) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: corsJson });

        const allowed = allowedStores(currentUser);
        if (allowed !== null && !allowed.includes(existing.store)) {
          return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsJson });
        }

        const now = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO supply_request_history (id, request_id, type, changed_by_id, changed_by_email, note, changed_at)
           VALUES (?, ?, 'comment', ?, ?, ?, ?)`
        ).bind(randomHex(12), id, currentUser.id, currentUser.email, note.trim(), now).run();
        await env.DB.prepare('UPDATE supply_requests SET updated_at = ? WHERE id = ?').bind(now, id).run();

        // Notify the other party (fire-and-forget, respects supply_notifications)
        ctx.waitUntil(notifySupplyComment(env, {
          requestId: id,
          store: existing.store,
          commenterId: currentUser.id,
          commenterEmail: currentUser.email,
          note: note.trim(),
          requesterId: existing.user_id,
          requesterEmail: existing.user_email,
        }));

        return new Response(JSON.stringify({ ok: true }), { headers: corsJson });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsJson });
      }
    }

    // ── Admin: item sales L2 totals from KV for a date range.
    //    ?action=item-l2-totals&store=BL1&start=YYYY-MM-DD&end=YYYY-MM-DD
    // Fetches every items:<store>:<date> KV snapshot in [start,end], merges
    // them, and returns L2 category totals (netSales + qty).
    // Used by the Item Sales Reconciliation tool.
    if (url.searchParams.get("action") === "item-l2-totals") {
      const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
      const unauth = requireAdminSecret(request, env, corsJson);
      if (unauth) return unauth;
      if (!env.SALES_SNAPSHOTS) {
        return new Response(JSON.stringify({ error: "KV not configured" }), { status: 500, headers: corsJson });
      }
      const store = (url.searchParams.get("store") || "").toUpperCase();
      const start = url.searchParams.get("start");
      const end   = url.searchParams.get("end");
      if (!store || !/^\d{4}-\d{2}-\d{2}$/.test(start || "") || !/^\d{4}-\d{2}-\d{2}$/.test(end || "")) {
        return new Response(JSON.stringify({ error: "Missing or invalid store/start/end (use YYYY-MM-DD)" }), { status: 400, headers: corsJson });
      }
      // Build list of dates in [start,end]
      const dates = [];
      const cur = new Date(start + "T12:00:00Z");
      const last = new Date(end + "T12:00:00Z");
      while (cur <= last) {
        dates.push(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
      if (dates.length > 366) {
        return new Response(JSON.stringify({ error: "Date range too large (max 366 days)" }), { status: 400, headers: corsJson });
      }
      const lc = store.toLowerCase();
      const snaps = await Promise.all(
        dates.map(d => env.SALES_SNAPSHOTS.get(`items:${lc}:${d}`, "json"))
      );
      const validSnaps = snaps.filter(Boolean);
      const merged = mergeItemSnapshots(validSnaps);
      // Return L2 categories sorted by netSales desc
      const categories = (merged.categories || [])
        .filter(c => c.netSales > 0)
        .sort((a, b) => b.netSales - a.netSales)
        .map(c => ({ category: c.category, netSales: roundCents(c.netSales), qty: Math.round(c.qty || 0) }));
      return new Response(JSON.stringify({
        ok: true, store, start, end,
        daysRequested: dates.length,
        daysWithData: validSnaps.length,
        categories,
        totals: { netSales: roundCents(merged.totals?.netSales || 0), qty: Math.round(merged.totals?.qty || 0) },
      }), { headers: corsJson });
    }

    // ── Admin: aggregated monthly totals from D1 for a store + date range.
    //    ?action=monthly-totals&store=BL1&start=2026-01&end=2026-05
    // Returns [{ yearMonth, total, days, manualOverrides }] grouped by month.
    // Used by the Sales Report Reconciliation tool to compare against a
    // pasted Clover Sales Report CSV.
    if (url.searchParams.get("action") === "monthly-totals") {
      const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
      const unauth = requireAdminSecret(request, env, corsJson);
      if (unauth) return unauth;
      if (!env.DB) {
        return new Response(JSON.stringify({ error: "DB not configured" }), { status: 500, headers: corsJson });
      }
      const store = (url.searchParams.get("store") || "").toUpperCase();
      const start = url.searchParams.get("start");
      const end = url.searchParams.get("end");
      if (!store || !/^\d{4}-\d{2}$/.test(start || "") || !/^\d{4}-\d{2}$/.test(end || "")) {
        return new Response(JSON.stringify({ error: "Missing or invalid store/start/end (use YYYY-MM)" }), { status: 400, headers: corsJson });
      }
      const startDate = `${start}-01`;
      const [endYr, endMo] = end.split("-").map(Number);
      const lastDate = new Date(Date.UTC(endYr, endMo, 0));
      const endDate = lastDate.toISOString().slice(0, 10);
      try {
        const { results } = await env.DB.prepare(
          `SELECT substr(date, 1, 7) AS yearMonth,
                  ROUND(SUM(total), 2) AS total,
                  COUNT(*) AS days,
                  SUM(CASE WHEN is_manual_override = 1 THEN 1 ELSE 0 END) AS manualOverrides
           FROM daily_sales
           WHERE store = ? AND date >= ? AND date <= ? AND total IS NOT NULL
           GROUP BY substr(date, 1, 7)
           ORDER BY yearMonth`
        ).bind(store, startDate, endDate).all();
        return new Response(JSON.stringify({ ok: true, store, start, end, results: results || [] }), { headers: corsJson });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsJson });
      }
    }

    // ── Admin: rebuild week-summary KV keys for an entire year (backfill)
    //    ?action=rebuild-week-summaries&year=2026
    // Iterates every distinct week in D1 for the given year and writes the
    // pre-roll for every store. Required before T13 will read from cache.
    if (url.searchParams.get("action") === "rebuild-week-summaries") {
      const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
      const unauth = requireAdminSecret(request, env, corsJson);
      if (unauth) return unauth;
      if (!env.DB || !env.SALES_SNAPSHOTS) {
        return new Response(JSON.stringify({ error: "DB or KV not configured" }), { status: 500, headers: corsJson });
      }
      const year = url.searchParams.get("year") || String(new Date().getUTCFullYear());

      // Default: rebuild the trailing 13 weeks (what T13 needs). Optional `weeks`
      // param overrides. Subrequest budget: 1 (week list) + per week [1 (dates) +
      // 6 stores × (1 D1 + 7 KV get + 1 KV put = 9)] = 1 + 13×55 = 716. Well
      // under Cloudflare's 1,000-per-invocation cap.
      const trailing = Math.max(1, Math.min(20, parseInt(url.searchParams.get("weeks") || "13", 10)));
      const { results } = await env.DB.prepare(
        "SELECT DISTINCT week FROM daily_sales WHERE date LIKE ? ORDER BY week DESC LIMIT ?"
      ).bind(`${year}-%`, trailing).all();
      const weeks = (results || []).map(r => r.week).filter(Boolean).reverse();

      const summary = { year: Number(year), weeks: weeks.length, written: 0, errors: [] };
      for (const wk of weeks) {
        // Resolve dates ONCE per week, reuse across all 6 stores.
        const dates = await resolveWeekDates(env, wk, year);
        if (!dates.length) continue;

        // Parallel per store within a week — drops wall-clock per week
        // from ~5s to ~1s. Concurrent subrequest pressure: 6 stores ×
        // (1 D1 + 7 KV get) = 48, just under CF's 50-concurrent limit.
        const settled = await Promise.allSettled(
          ALL_STORES.map(async (store) => {
            const bundle = await buildStoreWeekly(env, store, dates);
            const payload = {
              store, week: String(wk), year: Number(year), dates,
              totals: bundle.totals,
              l2Qty: bundle.l2Qty || {},
              l2Net: bundle.l2Net || {},
              snapshotTime: new Date().toISOString(),
            };
            await env.SALES_SNAPSHOTS.put(
              `week-summary:${store.toLowerCase()}:${wk}-${year}`,
              JSON.stringify(payload)
            );
            return store;
          })
        );
        settled.forEach((r, i) => {
          if (r.status === "fulfilled") {
            summary.written++;
          } else {
            summary.errors.push(`${ALL_STORES[i]}/${wk}: ${r.reason?.message || r.reason}`);
          }
        });
      }
      return new Response(JSON.stringify({ ok: true, ...summary }), { headers: corsJson });
    }

    // ── Item sales for a single ET hour: ?action=items-hour&store=BL1&date=YYYY-MM-DD&hour=14
    // Always live-fetches from Clover (narrow 1-hour window). Used by the hourly popup
    // drill-down when a user clicks a specific hour bar.
    if (url.searchParams.get("action") === "items-hour") {
      const store = (url.searchParams.get("store") || "").toUpperCase();
      if (!store) {
        return new Response(JSON.stringify({ error: "Missing store param" }), { status: 400, headers: corsJson });
      }
      if (!canAccessStore(currentUser, store)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsJson });
      }

      const { dateStr: todayStr } = getETToday();
      const dateParam = url.searchParams.get("date") || todayStr;
      const hourParam = parseInt(url.searchParams.get("hour") || "", 10);
      if (!Number.isFinite(hourParam) || hourParam < 0 || hourParam > 23) {
        return new Response(JSON.stringify({ error: "Invalid hour param (must be 0-23)" }), { status: 400, headers: corsJson });
      }

      const sinceTs = getStartOfDayET(dateParam) + hourParam * 3600000;
      const untilTs = sinceTs + 3600000;

      try {
        const [elements, refundElements, manualRefundElements] = await Promise.all([
          fetchItemOrders(store, env, sinceTs, untilTs),
          fetchRefundElements(store, env, sinceTs, untilTs),
          fetchManualRefunds(store, env, sinceTs, untilTs),
        ]);
        if (!elements) {
          return new Response(JSON.stringify({ error: "Store keys not found" }), { status: 404, headers: corsJson });
        }
        const itemCatMap = await fetchItemCategoryMap(store, env);
        const [overrides, itemCosts, extraOrders] = await Promise.all([
          fetchItemOverrides(env),
          fetchItemCosts(env),
          fetchCrossDayOrdersForRefunds(store, env, elements, refundElements),
        ]);
        const result = aggregateItemSales(elements, itemCatMap, store, dateParam, overrides, itemCosts, refundElements, extraOrders, manualRefundElements);
        result.hour = hourParam;
        return new Response(JSON.stringify(result), { headers: corsJson });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Items-hour fetch failed", detail: err.message }), {
          status: 500, headers: corsJson,
        });
      }
    }

    // ── Hourly net sales for a store+date: ?action=hourly&store=BL1&date=YYYY-MM-DD
    // Returns a 24-slot array of net sales per ET hour. Used by the Daily Sales Chart
    // popup to compare current day hour-by-hour against the same day last week.
    if (url.searchParams.get("action") === "hourly") {
      const store = (url.searchParams.get("store") || "").toUpperCase();
      if (!store) {
        return new Response(JSON.stringify({ error: "Missing store param" }), { status: 400, headers: corsJson });
      }
      if (!canAccessStore(currentUser, store)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsJson });
      }

      const { dateStr: todayStr } = getETToday();
      const dateParam = url.searchParams.get("date") || todayStr;

      const sinceTs = getStartOfDayET(dateParam);
      let untilTs = null;
      if (dateParam !== todayStr) {
        const nextDay = new Date(dateParam + 'T12:00:00Z');
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        untilTs = getStartOfDayET(nextDay.toISOString().slice(0, 10));
      }

      try {
        const elements = await fetchCloverOrders(store, env, sinceTs, untilTs);
        if (!elements) {
          return new Response(JSON.stringify({ error: "Store keys not found" }), { status: 404, headers: corsJson });
        }

        const hourFmt = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York',
          hour: '2-digit',
          hour12: false,
        });

        const hours = new Array(24).fill(0);
        for (const order of elements) {
          if (order.state !== "locked") continue;
          if (order.total == null || order.total === 0) continue;

          let taxCents = 0;
          if (order.payments?.elements) {
            for (const pmt of order.payments.elements) {
              taxCents += (pmt.taxAmount || 0);
            }
          }
          const orderNetCents = order.total - taxCents;

          // Intl formatToParts returns "24" for midnight under hour12:false in some runtimes;
          // normalize by parsing the hour string mod 24.
          const hourStr = hourFmt.format(new Date(order.createdTime));
          let h = parseInt(hourStr, 10);
          if (!Number.isFinite(h)) h = 0;
          h = h % 24;
          hours[h] += orderNetCents / 100;
        }

        const rounded = hours.map(v => roundCents(v));
        return new Response(JSON.stringify({ store, date: dateParam, hours: rounded }), { headers: corsJson });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Hourly fetch failed", detail: err.message }), {
          status: 500, headers: corsJson,
        });
      }
    }

    // ── Item sales by L2 category: ?action=items&store=BL1[&date=2026-04-08]
    if (url.searchParams.get("action") === "items") {
      const store = (url.searchParams.get("store") || "").toUpperCase();
      if (!store) {
        return new Response(JSON.stringify({ error: "Missing store param" }), { status: 400, headers: corsJson });
      }
      if (!canAccessStore(currentUser, store)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsJson });
      }

      const { dateStr: todayStr, startOfDay } = getETToday();
      const dateParam = url.searchParams.get("date");

      // If requesting a past date, serve from KV snapshot
      if (dateParam && dateParam !== todayStr) {
        const key = `items:${store.toLowerCase()}:${dateParam}`;
        const cached = env.SALES_SNAPSHOTS ? await env.SALES_SNAPSHOTS.get(key, "json") : null;
        if (cached) {
          return new Response(JSON.stringify(cached), { headers: corsJson });
        }
        return new Response(JSON.stringify({ store, date: dateParam, categories: [], totals: { qty: 0, gross: 0, discounts: 0, refunds: 0, netSales: 0, asp: 0 }, orderCount: 0 }), { headers: corsJson });
      }

      // Live fetch from Clover for today
      const merchantId = env[`${store}_MERCHANT_ID`];
      const apiToken = env[`${store}_API_TOKEN`];
      if (!merchantId || !apiToken) {
        return new Response(JSON.stringify({ error: "Store keys not found" }), { status: 404, headers: corsJson });
      }

      try {
        const [allElements, refundElements, itemCatMap, overrides, itemCosts] = await Promise.all([
          fetchItemOrders(store, env, startOfDay),
          fetchRefundElements(store, env, startOfDay),
          fetchItemCategoryMap(store, env),
          fetchItemOverrides(env),
          fetchItemCosts(env),
        ]);
        const result = aggregateItemSales(allElements || [], itemCatMap, store, todayStr, overrides, itemCosts, refundElements);
        return new Response(JSON.stringify(result), { headers: corsJson });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Items fetch failed", detail: err.message }), {
          status: 500, headers: corsJson,
        });
      }
    }

  // ── Admin: Schedule a sale ──────────────────────────────────────────────
  //    POST ?action=schedule-sale
  //    body: { store, items:[{id,name,priceCents}], discount:{kind,value}, startsAt, endsAt }
  if (request.method === "POST" && url.searchParams.get("action") === "schedule-sale") {
    const unauth = requireInventoryAccess(currentUser, isAdminSecret, corsJson);
    if (unauth) return unauth;
    const body = await request.json().catch(() => null);
    if (!body) return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: corsJson });
    const { store, items, discount, saleLabel, startsAt, endsAt } = body;
    if (!ALL_STORES.includes(store)) return new Response(JSON.stringify({ error: "Invalid store" }), { status: 400, headers: corsJson });
    if (!Array.isArray(items) || items.length === 0) return new Response(JSON.stringify({ error: "items must be a non-empty array" }), { status: 400, headers: corsJson });
    if (!discount?.kind || !["percent", "amount"].includes(discount.kind)) return new Response(JSON.stringify({ error: "discount.kind must be 'percent' or 'amount'" }), { status: 400, headers: corsJson });
    if (typeof discount.value !== "number" || discount.value <= 0) return new Response(JSON.stringify({ error: "discount.value must be a positive number" }), { status: 400, headers: corsJson });
    if (discount.kind === "percent" && discount.value >= 100) return new Response(JSON.stringify({ error: "Percent discount must be < 100" }), { status: 400, headers: corsJson });
    const sAt = new Date(startsAt), eAt = new Date(endsAt);
    if (isNaN(sAt) || isNaN(eAt)) return new Response(JSON.stringify({ error: "Invalid startsAt or endsAt" }), { status: 400, headers: corsJson });
    if (eAt <= sAt) return new Response(JSON.stringify({ error: "endsAt must be after startsAt" }), { status: 400, headers: corsJson });
    if (sAt < new Date()) return new Response(JSON.stringify({ error: "startsAt must be in the future" }), { status: 400, headers: corsJson });
    // Check for overlapping schedules
    const ids = items.map(i => `'${String(i.id).replace(/'/g,"")}'`).join(",");
    const overlap = await env.DB.prepare(
      `SELECT item_id FROM sale_schedules
       WHERE store=? AND item_id IN (${ids})
         AND status IN ('pending','active')
         AND starts_at < ? AND ends_at > ?
       LIMIT 1`
    ).bind(store, eAt.toISOString(), sAt.toISOString()).first();
    if (overlap) return new Response(JSON.stringify({ error: `Item ${overlap.item_id} already has an overlapping active/pending schedule` }), { status: 409, headers: corsJson });
    // Generate schedule group id (simple timestamp-based)
    const scheduleGroup = `sg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const stmt = env.DB.prepare(
      `INSERT INTO sale_schedules (schedule_group,store,item_id,item_name,discount_kind,discount_value,sale_label,starts_at,ends_at,status,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,'pending',?)`
    );
    const label = typeof saleLabel === "string" ? saleLabel.trim().slice(0, 30) || null : null;
    const stmts = items.map(item =>
      stmt.bind(scheduleGroup, store, item.id, item.name || "", discount.kind, discount.value, label, sAt.toISOString(), eAt.toISOString(), now)
    );
    await env.DB.batch(stmts);
    return new Response(JSON.stringify({ ok: true, scheduleGroup, count: items.length }), { headers: corsJson });
  }

  // ── Admin: List sale schedules ──────────────────────────────────────────
  //    GET ?action=list-sale-schedules&store=BL1&filter=upcoming|active|past|all
  if (url.searchParams.get("action") === "list-sale-schedules") {
    const unauth = requireInventoryAccess(currentUser, isAdminSecret, corsJson);
    if (unauth) return unauth;
    const store = url.searchParams.get("store") || "";
    const filter = url.searchParams.get("filter") || "all";
    if (!ALL_STORES.includes(store)) return new Response(JSON.stringify({ error: "Invalid store" }), { status: 400, headers: corsJson });
    let whereStatus = "";
    if (filter === "upcoming") whereStatus = "AND status='pending'";
    else if (filter === "active") whereStatus = "AND status='active'";
    else if (filter === "past") whereStatus = "AND status IN ('completed','cancelled','error')";
    const rows = await env.DB.prepare(
      `SELECT * FROM sale_schedules WHERE store=? ${whereStatus} ORDER BY starts_at DESC LIMIT 200`
    ).bind(store).all();
    // Group by schedule_group
    const groups = {};
    for (const row of (rows.results || [])) {
      if (!groups[row.schedule_group]) {
        groups[row.schedule_group] = { scheduleGroup: row.schedule_group, store: row.store, discountKind: row.discount_kind, discountValue: row.discount_value, startsAt: row.starts_at, endsAt: row.ends_at, status: row.status, createdAt: row.created_at, items: [] };
      }
      groups[row.schedule_group].items.push({ id: row.item_id, name: row.item_name, originalPrice: row.original_price, salePrice: row.sale_price, status: row.status, activatedAt: row.activated_at, revertedAt: row.reverted_at, errorMsg: row.error_msg });
      // Promote worst status to group level
      const rank = { error: 4, pending: 3, active: 2, completed: 1, cancelled: 0 };
      if ((rank[row.status] || 0) > (rank[groups[row.schedule_group].status] || 0)) {
        groups[row.schedule_group].status = row.status;
      }
    }
    return new Response(JSON.stringify({ ok: true, groups: Object.values(groups) }), { headers: corsJson });
  }

  // ── Admin: Cancel a sale schedule ──────────────────────────────────────
  //    POST ?action=cancel-sale-schedule  body: { scheduleGroup }
  if (request.method === "POST" && url.searchParams.get("action") === "cancel-sale-schedule") {
    const unauth = requireInventoryAccess(currentUser, isAdminSecret, corsJson);
    if (unauth) return unauth;
    const body = await request.json().catch(() => null);
    const { scheduleGroup } = body || {};
    if (!scheduleGroup) return new Response(JSON.stringify({ error: "Missing scheduleGroup" }), { status: 400, headers: corsJson });
    const rows = await env.DB.prepare(
      "SELECT * FROM sale_schedules WHERE schedule_group=? AND status IN ('pending','active')"
    ).bind(scheduleGroup).all();
    const pending = (rows.results || []).filter(r => r.status === "pending");
    const active  = (rows.results || []).filter(r => r.status === "active");
    const now = new Date().toISOString();
    const errors = [];
    // Cancel pending rows immediately
    if (pending.length) {
      await env.DB.prepare(
        `UPDATE sale_schedules SET status='cancelled' WHERE schedule_group=? AND status='pending'`
      ).bind(scheduleGroup).run();
    }
    // Force-revert active rows (restore both price and name)
    await Promise.allSettled(active.map(async row => {
      try {
        const store = row.store;
        const item = await getCloverItem(env, store, row.item_id);
        const revertFields = { price: item.price === row.sale_price ? row.original_price : item.price };
        if (row.original_name) revertFields.name = row.original_name;
        await setCloverItemFields(env, store, row.item_id, revertFields);
        await env.DB.prepare(
          "UPDATE sale_schedules SET status='completed', reverted_at=?, error_msg=? WHERE id=?"
        ).bind(now, "Cancelled by admin", row.id).run();
      } catch (err) {
        errors.push(`${row.item_id}: ${err.message}`);
        await env.DB.prepare(
          "UPDATE sale_schedules SET status='error', error_msg=? WHERE id=?"
        ).bind(String(err.message).slice(0, 500), row.id).run().catch(() => {});
      }
    }));
    return new Response(JSON.stringify({ ok: true, cancelled: pending.length, reverted: active.length - errors.length, errors }), { headers: corsJson });
  }

  // ── Admin: Delete (remove) a finished sale schedule from the log ─────
  //    POST ?action=delete-sale-schedule  body: { scheduleGroup }
  if (request.method === "POST" && url.searchParams.get("action") === "delete-sale-schedule") {
    const unauth = requireInventoryAccess(currentUser, isAdminSecret, corsJson);
    if (unauth) return unauth;
    const body = await request.json().catch(() => null);
    const { scheduleGroup } = body || {};
    if (!scheduleGroup) return new Response(JSON.stringify({ error: "Missing scheduleGroup" }), { status: 400, headers: corsJson });
    // Only allow deleting finished schedules (completed, cancelled, error)
    const active = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM sale_schedules WHERE schedule_group=? AND status IN ('pending','active')"
    ).bind(scheduleGroup).first();
    if (active && active.cnt > 0) return new Response(JSON.stringify({ error: "Cannot remove an active/pending schedule — cancel it first" }), { status: 400, headers: corsJson });
    await env.DB.prepare("DELETE FROM sale_schedules WHERE schedule_group=?").bind(scheduleGroup).run();
    return new Response(JSON.stringify({ ok: true }), { headers: corsJson });
  }

  // ── Admin: Manually trigger the sale scheduler (debug / test) ──────────
  //    POST ?action=run-sale-scheduler-now
  if (request.method === "POST" && url.searchParams.get("action") === "run-sale-scheduler-now") {
    const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
    const unauth = requireAdminSecret(request, env, corsJson);
    if (unauth) return unauth;
    const result = await processSaleSchedules(env, new Date());
    return new Response(JSON.stringify({ ok: true, ...result }), { headers: corsJson });
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
      // Fetch orders + refunds + item-categorization inputs in parallel.
      //
      // Refunds (from /v3/refunds) live on a separate Clover endpoint and are
      // NOT subtracted from order.total, so the dashboard needs the refunds
      // total to compute Net Sales correctly.
      //
      // Bin/retail split: the frontend used to classify line items by name
      // regex (\bbin\b, etc.), but Clover items in the "Bin Products" L3
      // category don't necessarily have "bin" in their name. We now run the
      // proper category-based aggregation server-side and return binNet /
      // retailNet so the dashboard matches the Item Sales breakdown.
      const [elements, refundElements, itemCatMap, overrides, itemCosts] = await Promise.all([
        fetchItemOrders(targetStore, env, startOfToday),
        fetchRefundElements(targetStore, env, startOfToday),
        fetchItemCategoryMap(targetStore, env),
        fetchItemOverrides(env),
        fetchItemCosts(env),
      ]);
      // Filter out same-day refunds whose amounts are already reflected in
      // order.total (Clover updates the order before our snapshot runs).
      // Same logic as fetchRefundsTotal's sameDayOrders path.
      const _sameDayReflected = new Map();
      for (const order of (elements || [])) {
        const pmtSum = (order.payments?.elements || []).reduce((s, p) => s + (p.amount || 0), 0);
        const pmtTax = (order.payments?.elements || []).reduce((s, p) => s + (p.taxAmount || 0), 0);
        if (order.total === 0 && pmtSum > 0) {
          const preTax = pmtSum - pmtTax;
          if (preTax > 0) _sameDayReflected.set(preTax, (_sameDayReflected.get(preTax) || 0) + 1);
        } else if (order.total > 0 && pmtSum > order.total) {
          const delta = pmtSum - order.total;
          if (delta > 0) _sameDayReflected.set(delta, (_sameDayReflected.get(delta) || 0) + 1);
        }
      }
      const refundCents = (refundElements || []).reduce((s, r) => {
        const preTax = (r.amount || 0) - (r.taxAmount || 0);
        if (_sameDayReflected.has(preTax) && _sameDayReflected.get(preTax) > 0) {
          _sameDayReflected.set(preTax, _sameDayReflected.get(preTax) - 1);
          return s; // already in order.total — skip
        }
        return s + preTax;
      }, 0);

      // Server-side category-based bin/retail split. aggregateItemSales returns
      // categories[] keyed by L2; pull "Bin Products" netSales and treat the
      // remainder of revenue-bearing categories as retail.
      let binNet = 0, retailNet = 0;
      if (elements && elements.length > 0) {
        const itemAgg = aggregateItemSales(
          elements, itemCatMap, targetStore, et.dateStr, overrides, itemCosts, refundElements
        );
        for (const c of (itemAgg.categories || [])) {
          if (c.category === "Bin Products") binNet += c.netSales;
          else retailNet += c.netSales;
        }
      }

      const result = JSON.stringify({
        elements: elements || [],
        refundCents: refundCents || 0,
        binNet,
        retailNet,
      });
      const response = new Response(result, {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

      // Snapshot-on-fetch: save today's aggregated data to KV in background
      if (env.SALES_SNAPSHOTS && elements && elements.length > 0) {
        const aggregated = aggregateOrders(elements, startOfToday);
        applyRefundsToAggregate(aggregated, refundCents);
        // Override the regex-based bin/retail with the category-based figures
        // computed above so daily_sales matches the Item Sales view.
        aggregated.bin = +binNet.toFixed(2);
        aggregated.retail = +retailNet.toFixed(2);
        ctx.waitUntil(saveSnapshot(env, targetStore, et.dateStr, aggregated));
      }

      return response;
    } catch (error) {
      return new Response(JSON.stringify({ error: "Failed to connect to Clover" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },

  // ── Cron trigger handler ───────────────────────────────────────
  async scheduled(event, env, ctx) {
    // Route by cron expression.
    // "0 * * * *" — top-of-hour interval sales summary push notifications
    if (event.cron === "0 * * * *") {
      ctx.waitUntil(
        dispatchIntervalSummary(env).then(r => console.log("Interval summary dispatch:", JSON.stringify(r)))
      );
      return;
    }

    // "* * * * *" — every-minute sale scheduler
    if (event.cron === "* * * * *") {
      ctx.waitUntil(processSaleSchedules(env, new Date()));
      return;
    }

    // "0 10 * * *" — 5 AM ET daily summary (10:00 UTC = EST; shifts to 6 AM during EDT)
    if (event.cron === "0 10 * * *") {
      const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(yesterday);
      ctx.waitUntil(
        dispatchDailySummary(env, date).then(r => console.log("Daily summary dispatch:", JSON.stringify(r)))
      );
      return;
    }

    // "0 11 * * 0" — 7 AM ET Sunday weekly digest (11:00 UTC = EDT / 6 AM EST)
    // Cloudflare cron uses standard POSIX day-of-week: 0=Sunday, 6=Saturday.
    // Summarises the Sun–Sat week that just ended.
    if (event.cron === "0 11 * * 0") {
      // endDate = yesterday (Saturday), startDate = 6 days before that (Sunday)
      const endD = new Date(Date.now() - 24 * 3600 * 1000);
      const startD = new Date(endD.getTime() - 6 * 24 * 3600 * 1000);
      const etFmt = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
      ctx.waitUntil(
        dispatchWeeklyDigest(env, etFmt(startD), etFmt(endD))
          .then(r => console.log("Weekly digest dispatch:", JSON.stringify(r)))
      );
      return;
    }

    // "30 10 * * *" — daily Meta Marketing insights refresh (Phase 2)
    if (event.cron === "30 10 * * *") {
      ctx.waitUntil(
        fetchMetaInsights(env).then(r => console.log("Meta insights refresh:", JSON.stringify(r)))
      );
      return;
    }

    // "55 3 * * *" — nightly end-of-day snapshot rollup (fall-through below)
    const { dateStr: todayStr, startOfDay } = getETToday();

    const results = {};
    const [overrides, itemCosts] = await Promise.all([
      fetchItemOverrides(env),
      fetchItemCosts(env),
    ]);

    for (const store of ALL_STORES) {
      try {
        // Phase 2D: compute item-snapshot FIRST so we can pass category-based
        // bin/retail into the sales snapshot. Previously these ran independently
        // and D1 daily_sales.bin used name-based isBinItem() regex while the
        // Item Sales tab used Clover's "Bin Products" L3 category → numbers
        // diverged. By running aggregateItemSales here and threading the
        // result into fetchAggregateAndSnapshot, both stores read from a
        // single source of truth.
        let itemData = null;
        let binRetailOverride = null;
        try {
          const [elements, refundElements, manualRefundElements] = await Promise.all([
            fetchItemOrders(store, env, startOfDay),
            fetchRefundElements(store, env, startOfDay),
            fetchManualRefunds(store, env, startOfDay),
          ]);
          if (elements && elements.length > 0) {
            const itemCatMap = await fetchItemCategoryMap(store, env);
            const extraOrders = await fetchCrossDayOrdersForRefunds(store, env, elements, refundElements);
            itemData = aggregateItemSales(elements, itemCatMap, store, todayStr, overrides, itemCosts, refundElements, extraOrders, manualRefundElements);
            let binNet = 0, retailNet = 0;
            for (const c of (itemData.categories || [])) {
              if (c.category === "Bin Products") binNet += c.netSales;
              else retailNet += c.netSales;
            }
            // Phase 3: include grand total so D1.total = sum of categories.
            binRetailOverride = {
              bin: binNet,
              retail: retailNet,
              total: itemData.totals?.netSales,
            };
          }
        } catch (itemErr) {
          // Item-snapshot prep failure should not block the sales snapshot —
          // fall through with binRetailOverride = null so fetchAggregateAndSnapshot
          // still runs with its (less accurate) name-based bin classification.
          console.warn(`Item snapshot prep failed for ${store}: ${itemErr.message}`);
        }

        // Sales snapshot (now with category-based bin/retail if available)
        const data = await fetchAggregateAndSnapshot(store, env, startOfDay, todayStr, null, binRetailOverride);
        results[store] = { sales: data ? "ok" : "skipped" };

        // Persist the item snapshot we already computed above.
        if (itemData) {
          try {
            await saveItemSalesSnapshot(env, store, todayStr, itemData);
            results[store].items = "ok";
          } catch (saveErr) {
            results[store].items = `error: ${saveErr.message}`;
          }
        } else {
          results[store].items = "skipped";
        }
      } catch (err) {
        results[store] = `error: ${err.message}`;
      }
    }

    // ── clientCreatedTime lookback sweep ──────────────────────────────
    // Re-snapshot today + the last couple days bucketed by ACTUAL sale time
    // (clientCreatedTime), so orders rung up offline and synced late (e.g. a
    // power outage) land on the correct day. Re-doing today removes late syncs
    // that belong to an earlier day; the prior-day passes add them back where
    // they belong. Manual-override rows are preserved. Idempotent & self-
    // correcting; see snapshotDayByClientTime().
    const SWEEP_LOOKBACK_DAYS = 2;   // today + 2 prior = 3 days
    const sweepAddDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    const sweepWeeks = new Set();
    for (let k = 0; k <= SWEEP_LOOKBACK_DAYS; k++) {
      const d = sweepAddDays(todayStr, -k);
      for (const store of ALL_STORES) {
        try {
          const r = await snapshotDayByClientTime(store, env, d, SWEEP_LOOKBACK_DAYS);
          if (r && !r.skippedManualOverride && !r.skippedZeroOverwrite) sweepWeeks.add(d);
        } catch (e) {
          console.warn(`[clienttime-sweep] ${store}/${d} failed: ${e.message}`);
        }
      }
    }
    // Re-roll any week the sweep may have changed (a lookback day can fall in
    // the prior week, which the todayStr rollup below wouldn't cover).
    for (const d of sweepWeeks) {
      try { await rollupWeekSummariesIfReady(env, d); } catch (e) {
        console.warn(`[clienttime-sweep] rollup ${d} failed: ${e.message}`);
      }
    }
    console.log(`[clienttime-sweep] done: ${SWEEP_LOOKBACK_DAYS + 1} days x ${ALL_STORES.length} stores`);

    // Roll up week-summary KV keys for any week whose 7 days are now in D1.
    // Lets the Weekly Retail T13 endpoint serve from pre-rolled summaries
    // instead of doing 500+ KV reads per page visit.
    try {
      await rollupWeekSummariesIfReady(env, todayStr);
    } catch (err) {
      console.error("Week summary rollup failed:", err.message);
    }

    console.log("Daily snapshot results:", JSON.stringify(results));

    // 6B: Push alert to superusers if any store snapshot errored.
    const failedStores = ALL_STORES.filter(s =>
      typeof results[s] === 'string' && results[s].startsWith('error:')
    );
    if (failedStores.length > 0) {
      ctx.waitUntil(
        dispatchCronFailureAlert(env, failedStores)
          .catch(e => console.error("Cron failure alert error:", e.message))
      );
    }
  },
};
