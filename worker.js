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
async function fetchCloverOrders(store, env, sinceTimestamp, untilTimestamp = null) {
  const targetStore = store.toUpperCase();
  const merchantId = env[`${targetStore}_MERCHANT_ID`];
  const apiToken = env[`${targetStore}_API_TOKEN`];

  if (!merchantId || !apiToken) return null;

  const limit = 1000;
  let offset = 0;
  const allElements = [];

  while (true) {
    let cloverUrl = `https://api.clover.com/v3/merchants/${merchantId}/orders`
      + `?filter=createdTime>=${sinceTimestamp}`
      + `&filter=state=locked`
      + `&expand=payments,lineItems`
      + `&limit=${limit}&offset=${offset}`;
    if (untilTimestamp) cloverUrl += `&filter=createdTime<${untilTimestamp}`;

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
  let orderCount = 0, totalItemCount = 0, retailItemCount = 0;
  let totalTxnTimeMs = 0, txnTimeCount = 0;
  let cartNet = 0, cartCount = 0; // avg cart excludes bin-only orders

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
          if (orderNet > 0) retailItemCount += qty;
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

    // Avg cart: count only orders with retail items; use retail portion only
    if (orderNet > 0) {
      if (itemGross === 0) {
        // No line items (manual entry) — treat as retail
        cartNet += orderNet;
        cartCount++;
      } else if (retailItemTotal > 0) {
        cartNet += orderNet * (retailItemTotal / itemGross);
        cartCount++;
      }
      // Pure bin orders (retailItemTotal === 0) are excluded
    }
  }

  const avgCart = cartCount > 0 ? (cartNet / cartCount) / 100 : 0;
  const avgItems = orderCount > 0 ? totalItemCount / orderCount : 0;
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
        cats[name] = { qty: 0, gross: 0, discounts: 0, refunds: 0, net: 0, cost: 0, l3: {} };
      }
      const bucket = cats[name];
      bucket.qty += Number(c.qty) || 0;
      bucket.gross += Number(c.gross) || 0;
      bucket.discounts += Number(c.discounts) || 0;
      bucket.refunds += Number(c.refunds) || 0;
      bucket.net += Number(c.netSales) || 0;
      bucket.cost += Number(c.cost) || 0;
      if (Array.isArray(c.l3Rows)) {
        for (const l of c.l3Rows) {
          const lName = l.l3 || "(uncategorized)";
          if (!bucket.l3[lName]) {
            bucket.l3[lName] = { qty: 0, gross: 0, discounts: 0, refunds: 0, net: 0, cost: 0 };
          }
          const lb = bucket.l3[lName];
          lb.qty += Number(l.qty) || 0;
          lb.gross += Number(l.gross) || 0;
          lb.discounts += Number(l.discounts) || 0;
          lb.refunds += Number(l.refunds) || 0;
          lb.net += Number(l.netSales) || 0;
          lb.cost += Number(l.cost) || 0;
        }
      }
    }
  }
  let totalQty = 0, totalGross = 0, totalDisc = 0, totalRef = 0, totalNet = 0, totalCost = 0;
  const categories = [];
  for (const [name, c] of Object.entries(cats)) {
    totalQty += c.qty; totalGross += c.gross; totalDisc += c.discounts;
    totalRef += c.refunds; totalNet += c.net; totalCost += c.cost;
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

  // KPI totals from D1 daily rows. Use D1 `total` (= aggregated sales) as the
  // single source of truth for net sales, mirroring the dashboard's behavior
  // — keeps Weekly Retail's Net Sales identical to the Dashboard's week total.
  let netSales = 0, retail = 0, bin = 0, auction = 0, budget = 0, transactions = 0;
  let laborNumerator = 0, laborDenominator = 0;
  for (const r of dailyRows) {
    netSales += Number(r.total) || 0;
    retail += Number(r.retail) || 0;
    bin += Number(r.bin) || 0;
    auction += Number(r.auction) || 0;
    budget += Number(r.budget) || 0;
    transactions += Number(r.order_count) || 0;
    const lp = Number(r.labor_pct);
    const t = Number(r.total);
    if (Number.isFinite(lp) && Number.isFinite(t) && t > 0) {
      laborNumerator += lp * t;
      laborDenominator += t;
    }
  }
  const merged = mergeItemSnapshots(itemSnaps.filter(Boolean));
  const qty = merged.totals.qty;
  const asp = qty > 0 ? netSales / qty : 0;
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
  "Seasonal", "Bin Products", "Sku Book Items", "Custom Sales", "Refund",
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
const EMPTY_ITEM_COSTS = { items: {}, importedAt: null, count: 0 };

async function fetchItemCosts(env) {
  if (!env.SALES_SNAPSHOTS) return EMPTY_ITEM_COSTS;
  const val = await env.SALES_SNAPSHOTS.get(ITEM_COSTS_KEY, "json");
  if (!val || typeof val !== "object") return EMPTY_ITEM_COSTS;
  return {
    items: val.items && typeof val.items === "object" ? val.items : {},
    importedAt: val.importedAt || null,
    count: Number(val.count) || 0,
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
function aggregateItemSales(allElements, itemCatMap, store, dateStr, overrides, itemCosts) {
  const ov = overrides || EMPTY_OVERRIDES;
  const ovItems = ov.items || {};
  const ovPatterns = ov.patterns || [];
  const ic = itemCosts || EMPTY_ITEM_COSTS;
  const icItems = ic.items || {};
  const cats = {};        // L2 → { qty, gross, discounts, refunds, net, cost }
  const l3Cats = {};      // L2 → L3 → { qty, gross, discounts, refunds, net, cost }
  const unmappedL3 = {};
  const noCategory = {};
  function getCat(name) {
    if (!cats[name]) cats[name] = { qty: 0, gross: 0, discounts: 0, refunds: 0, net: 0, cost: 0 };
    return cats[name];
  }
  function getL3(l2, l3) {
    if (!l3Cats[l2]) l3Cats[l2] = {};
    if (!l3Cats[l2][l3]) l3Cats[l2][l3] = { qty: 0, gross: 0, discounts: 0, refunds: 0, net: 0, cost: 0 };
    return l3Cats[l2][l3];
  }

  for (const order of allElements) {
    if (order.total == null || order.total === 0) continue;
    if (order.state !== "locked") continue;

    let taxCents = 0;
    if (order.payments?.elements) {
      for (const pmt of order.payments.elements) {
        taxCents += (pmt.taxAmount || 0);
      }
    }
    const orderNetCents = order.total - taxCents;

    const lineItems = order.lineItems?.elements || [];
    let orderLineItemNetCents = 0;

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
        } else {
          if (imNum && IM_TO_L2[imNum]) {
            l2 = IM_TO_L2[imNum];
            l2Source = "im";
          } else {
            const n = (li.name || "").toUpperCase();
            if (/EASTER|VALENTINE|CHRISTMAS|HALLOWEEN|FOURTH OF JULY|4TH OF JULY|ST[.\s]*PATRICK|HOLIDAY|SEASONAL/i.test(n)) {
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

      let discCents = 0;
      if (li.discounts?.elements) {
        for (const d of li.discounts.elements) {
          discCents += Math.abs(d.amount || 0);
        }
      }

      // Cost lookup: join on the IM number we extracted at the top of the loop.
      // Misses (no imNum, or imNum not in master) silently contribute 0 — those
      // rows will render with `—` in the CPU/Ext Cost columns.
      const costRecord = imNum ? icItems[imNum] : null;
      const unitCost = (costRecord && Number.isFinite(Number(costRecord.cost)))
        ? Number(costRecord.cost) : 0;

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
        orderLineItemNetCents += (grossCents - discCents);
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
  }

  // Calculate totals and format response
  let totalQty = 0, totalGross = 0, totalDisc = 0, totalRef = 0, totalNet = 0, totalCost = 0;
  const categories = [];
  for (const [name, c] of Object.entries(cats)) {
    totalQty += c.qty;
    totalGross += c.gross;
    totalDisc += c.discounts;
    totalRef += c.refunds;
    totalNet += c.net;
    totalCost += c.cost;
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
    },
    orderCount: allElements.length,
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
      + `&expand=payments,lineItems.item,lineItems.discounts`
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

// ─── Fetch and aggregate for a store, then snapshot ──────────────
async function fetchAggregateAndSnapshot(store, env, sinceTimestamp, dateStr) {
  const elements = await fetchCloverOrders(store, env, sinceTimestamp);
  if (!elements) return null;

  const data = aggregateOrders(elements, sinceTimestamp);
  await saveSnapshot(env, store, dateStr, data);
  return data;
}

// ─── CORS headers ────────────────────────────────────────────────
// Allowlist-based CORS. Echoes the matching Origin back so that Phase 2 can
// enable Access-Control-Allow-Credentials for session cookies without a
// second CORS refactor. Unknown origins get no Allow-Origin header and the
// browser blocks the response.
const ALLOWED_ORIGINS = [
  "https://www.retjghub.com",
  "https://retjghub.com",
];
// localhost on any port for dev (http://localhost:1234, http://127.0.0.1:5500, etc.)
const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function resolveCors(request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) || LOCALHOST_RE.test(origin);
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

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
  const link = `https://api.retjghub.com/?action=auth-verify&token=${token}`;
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
  const link = `https://api.retjghub.com/?action=auth-verify&token=${token}`;
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
      if (!token) return Response.redirect("https://www.retjghub.com/?auth_error=invalid", 302);
      try {
        const now = new Date().toISOString();
        const { results } = await env.DB.prepare(
          "SELECT email, expires_at, used_at FROM magic_links WHERE token = ?"
        ).bind(token).all();
        if (!results || !results.length || results[0].used_at || results[0].expires_at < now) {
          return Response.redirect("https://www.retjghub.com/?auth_error=expired", 302);
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
          return Response.redirect("https://www.retjghub.com/?auth_error=nouser", 302);
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
            "Location": "https://www.retjghub.com/",
            "Set-Cookie": sessionCookie(sessionId, 7 * 24 * 60 * 60),
          },
        });
      } catch (e) {
        return Response.redirect("https://www.retjghub.com/?auth_error=server", 302);
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

    // ── Manual snapshot endpoint: ?action=snapshot&store=BL1
    if (url.searchParams.get("action") === "snapshot") {
      const unauth = requireAdminSecret(request, env, corsHeaders);
      if (unauth) return unauth;

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
                   avg_asp=COALESCE(excluded.avg_asp, avg_asp),
                   snapshot_time=COALESCE(excluded.snapshot_time, snapshot_time)`
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
          const elements = await fetchItemOrders(store, env, sinceTs, untilTs);
          if (!elements) { results[store] = "skipped (no credentials)"; continue; }
          const itemCatMap = await fetchItemCategoryMap(store, env);
          const itemData = aggregateItemSales(elements, itemCatMap, store, dateParam, overrides, itemCosts);
          await saveItemSalesSnapshot(env, store, dateParam, itemData);
          results[store] = { ok: true, orders: itemData.orderCount, netSales: itemData.totals.netSales };
        } catch (e) {
          results[store] = { error: e.message };
        }
      }
      return new Response(JSON.stringify({ ok: true, date: dateParam, results }), { headers: corsJson });
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
            const elements = await fetchItemOrders(store, env, sinceTs, untilTs);
            if (!elements) { storeOut.details.push({ date: dateStr, note: "no credentials" }); continue; }
            const itemData = aggregateItemSales(elements, catMapCache[store], store, dateStr, overrides, itemCosts);
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

        const rawItems = body?.items;
        if (!rawItems || typeof rawItems !== "object") {
          return new Response(JSON.stringify({ error: "Body must include items: { itemNo: { cost, desc } }" }), { status: 400, headers: corsJson });
        }

        const cleaned = {};
        let rejected = 0;
        for (const [k, v] of Object.entries(rawItems)) {
          if (!/^\d{4,5}$/.test(String(k))) { rejected++; continue; }
          const cost = Number(v?.cost);
          if (!Number.isFinite(cost) || cost < 0) { rejected++; continue; }
          cleaned[String(k)] = {
            cost: Math.round(cost * 10000) / 10000,
            desc: typeof v?.desc === "string" ? v.desc : "",
          };
        }
        const payload = {
          items: cleaned,
          importedAt: new Date().toISOString(),
          count: Object.keys(cleaned).length,
        };
        await env.SALES_SNAPSHOTS.put(ITEM_COSTS_KEY, JSON.stringify(payload));
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
        const cAsp = cQty > 0 ? cNet / cQty : 0;
        const cVar = cNet - cBudget;
        const cVarPct = cBudget > 0 ? (cVar / cBudget) * 100 : 0;
        const cLabor = cLaborDen > 0 ? cLaborNum / cLaborDen : 0;

        // L2 × store matrix (scoped stores only)
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
        for (const wkObj of weeks) {
          const wk = wkObj.week;
          const perStore = {};
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
                summary = { totals: bundle.totals };
              } else {
                summary = { totals: { netSales: 0, qty: 0, transactions: 0, asp: 0, laborPct: 0, budget: 0 } };
              }
            }
            perStore[s] = summary.totals;
          }));

          let wkNet = 0, wkQty = 0, wkTxn = 0, wkBudget = 0, wkLaborNum = 0, wkLaborDen = 0;
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
            const tn = Number(t.netSales) || 0;
            if (tn > 0) {
              wkLaborNum += (Number(t.laborPct) || 0) * tn;
              wkLaborDen += tn;
            }
          }
          total.netSales.push(roundCents(wkNet));
          total.qty.push(wkQty);
          total.transactions.push(wkTxn);
          total.asp.push(wkQty > 0 ? roundCents(wkNet / wkQty) : 0);
          total.laborPct.push(wkLaborDen > 0 ? Math.round((wkLaborNum / wkLaborDen) * 10) / 10 : 0);
          total.budget.push(roundCents(wkBudget));
        }

        if (liveBuilds > 0) {
          console.warn(`weekly-t13: ${liveBuilds} live aggregations (consider running ?action=rebuild-week-summaries)`);
        }

        return new Response(JSON.stringify({
          weeks: weeks.map(w => w.week),
          dates: weeks,
          stores,
          total,
          liveBuilds,
        }), { headers: corsJson });
      } catch (err) {
        return new Response(JSON.stringify({ error: "weekly-t13 failed", detail: err.message }), { status: 500, headers: corsJson });
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

      const { results } = await env.DB.prepare(
        "SELECT DISTINCT week FROM daily_sales WHERE date LIKE ? ORDER BY week"
      ).bind(`${year}-%`).all();
      const weeks = (results || []).map(r => r.week).filter(Boolean);

      const jobs = weeks.flatMap(wk =>
        ALL_STORES.map(store => ({ wk, store }))
      );
      const settled = await Promise.allSettled(
        jobs.map(({ wk, store }) => writeWeekSummary(env, store, wk, year))
      );
      const summary = { year: Number(year), weeks: weeks.length, written: 0, errors: [] };
      settled.forEach((r, i) => {
        const { wk, store } = jobs[i];
        if (r.status === "fulfilled") {
          if (r.value) summary.written++;
        } else {
          summary.errors.push(`${store}/${wk}: ${r.reason?.message || r.reason}`);
        }
      });
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
        const elements = await fetchItemOrders(store, env, sinceTs, untilTs);
        if (!elements) {
          return new Response(JSON.stringify({ error: "Store keys not found" }), { status: 404, headers: corsJson });
        }
        const itemCatMap = await fetchItemCategoryMap(store, env);
        const [overrides, itemCosts] = await Promise.all([
          fetchItemOverrides(env),
          fetchItemCosts(env),
        ]);
        const result = aggregateItemSales(elements, itemCatMap, store, dateParam, overrides, itemCosts);
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
        const allElements = await fetchItemOrders(store, env, startOfDay);
        const itemCatMap = await fetchItemCategoryMap(store, env);
        const [overrides, itemCosts] = await Promise.all([
          fetchItemOverrides(env),
          fetchItemCosts(env),
        ]);
        const result = aggregateItemSales(allElements || [], itemCatMap, store, todayStr, overrides, itemCosts);
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

  // ── Cron trigger handler ───────────────────────────────────────
  async scheduled(event, env, ctx) {
    // Route by cron expression.
    // "* * * * *" — every-minute sale scheduler
    if (event.cron === "* * * * *") {
      ctx.waitUntil(processSaleSchedules(env, new Date()));
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
        // Sales snapshot (existing)
        const data = await fetchAggregateAndSnapshot(store, env, startOfDay, todayStr);
        results[store] = { sales: data ? "ok" : "skipped" };

        // Item sales snapshot (new)
        try {
          const elements = await fetchItemOrders(store, env, startOfDay);
          if (elements) {
            const itemCatMap = await fetchItemCategoryMap(store, env);
            const itemData = aggregateItemSales(elements, itemCatMap, store, todayStr, overrides, itemCosts);
            await saveItemSalesSnapshot(env, store, todayStr, itemData);
            results[store].items = "ok";
          } else {
            results[store].items = "skipped";
          }
        } catch (itemErr) {
          results[store].items = `error: ${itemErr.message}`;
        }
      } catch (err) {
        results[store] = `error: ${err.message}`;
      }
    }

    // Roll up week-summary KV keys for any week whose 7 days are now in D1.
    // Lets the Weekly Retail T13 endpoint serve from pre-rolled summaries
    // instead of doing 500+ KV reads per page visit.
    try {
      await rollupWeekSummariesIfReady(env, todayStr);
    } catch (err) {
      console.error("Week summary rollup failed:", err.message);
    }

    console.log("Daily snapshot results:", JSON.stringify(results));
  },
};
