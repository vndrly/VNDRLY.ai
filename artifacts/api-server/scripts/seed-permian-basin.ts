/**
 * Seed major Permian Basin oil & gas players into Partners (operators)
 * and Vendors (oilfield service companies).
 *
 * Idempotent: matches existing rows by canonical (lower(btrim(name)))
 * form for both partners and vendors, mirroring the
 * partners_canonical_name_unique / vendors_canonical_name_unique DB
 * indexes. If a row already exists, we ONLY fill blank fields — we
 * never overwrite real data the user has typed.
 *
 * Note: Enron is intentionally omitted. Enron Corp. collapsed in 2001;
 * its oil & gas exploration arm ("Enron Oil & Gas") was spun off in
 * 1999 and renamed EOG Resources, which is included below.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx scripts/seed-permian-basin.ts
 */
import { eq, sql } from "drizzle-orm";
import {
  db,
  partnersTable,
  vendorsTable,
  type InsertPartner,
  type InsertVendor,
} from "@workspace/db";

type PartnerSeed = Omit<InsertPartner, "name"> & { name: string };
type VendorSeed = Omit<InsertVendor, "name"> & { name: string };

const PARTNERS: PartnerSeed[] = [
  {
    name: "ExxonMobil",
    contactName: "James Richardson",
    contactEmail: "j.richardson@exxon.example.com",
    contactPhone: "(972) 940-6000",
    businessPhone: "(972) 940-6000",
    physicalAddress: "22777 Springwoods Village Pkwy, Spring, TX 77389",
    billingAddress: "22777 Springwoods Village Pkwy, Spring, TX 77389",
    hoursOfOperation: "24/7 field operations · M–F 8a–5p HQ",
    blurb:
      "Largest U.S. oil major. Permian operations centered on the Delaware and Midland Basins; absorbed Pioneer Natural Resources in 2024, making it the dominant Permian producer.",
    operatingRadiusMiles: 250,
    brandPrimaryColor: "#E1241B",
    brandAccentColor: "#003B70",
  },
  {
    name: "Chevron",
    contactName: "Sarah Mitchell",
    contactEmail: "s.mitchell@chevron.example.com",
    contactPhone: "(925) 842-1000",
    businessPhone: "(925) 842-1000",
    physicalAddress: "6001 Bollinger Canyon Rd, San Ramon, CA 94583",
    billingAddress: "6001 Bollinger Canyon Rd, San Ramon, CA 94583",
    hoursOfOperation: "24/7 field operations · M–F 8a–5p HQ",
    blurb:
      "Second-largest U.S. major. Long-standing Permian acreage in both the Delaware and Midland Basins; producing over 800k boe/d from the Permian.",
    operatingRadiusMiles: 250,
    brandPrimaryColor: "#0066B2",
    brandAccentColor: "#ED1C24",
  },
  {
    name: "ConocoPhillips",
    contactName: "Robert Chen",
    contactEmail: "r.chen@conoco.example.com",
    contactPhone: "(281) 293-1000",
    businessPhone: "(281) 293-1000",
    physicalAddress: "925 N Eldridge Pkwy, Houston, TX 77079",
    billingAddress: "925 N Eldridge Pkwy, Houston, TX 77079",
    hoursOfOperation: "24/7 field operations · M–F 8a–5p HQ",
    blurb:
      "Independent E&P major. Expanded Permian footprint significantly via the 2021 Concho Resources acquisition and the 2024 Marathon Oil deal.",
    operatingRadiusMiles: 250,
    brandPrimaryColor: "#EE3124",
    brandAccentColor: "#003366",
  },
  {
    name: "Pioneer Natural Resources",
    contactName: "Operations Desk",
    contactEmail: "ops@pioneer.example.com",
    contactPhone: "(972) 444-9001",
    businessPhone: "(972) 444-9001",
    physicalAddress: "777 Hidden Ridge, Irving, TX 75038",
    billingAddress: "777 Hidden Ridge, Irving, TX 75038",
    hoursOfOperation: "24/7 field operations · M–F 8a–5p HQ",
    blurb:
      "Legacy pure-play Midland Basin operator, acquired by ExxonMobil in May 2024. Retained as an operating brand for several Permian programs.",
    operatingRadiusMiles: 200,
    brandPrimaryColor: "#1F3A6D",
    brandAccentColor: "#F2A900",
  },
  {
    name: "Diamondback Energy",
    contactName: "Operations Desk",
    contactEmail: "ops@diamondback.example.com",
    contactPhone: "(432) 221-7400",
    businessPhone: "(432) 221-7400",
    physicalAddress: "500 W Texas Ave, Suite 1200, Midland, TX 79701",
    billingAddress: "500 W Texas Ave, Suite 1200, Midland, TX 79701",
    hoursOfOperation: "24/7 field operations · M–F 8a–5p HQ",
    blurb:
      "Pure-play Permian operator headquartered in Midland. Combined with Endeavor Energy in 2024 to become one of the largest Midland Basin producers.",
    operatingRadiusMiles: 175,
    brandPrimaryColor: "#1A1A1A",
    brandAccentColor: "#C8A24B",
  },
  {
    name: "Occidental Petroleum",
    contactName: "Operations Desk",
    contactEmail: "ops@oxy.example.com",
    contactPhone: "(713) 215-7000",
    businessPhone: "(713) 215-7000",
    physicalAddress: "5 Greenway Plaza, Houston, TX 77046",
    billingAddress: "5 Greenway Plaza, Houston, TX 77046",
    hoursOfOperation: "24/7 field operations · M–F 8a–5p HQ",
    blurb:
      "Major independent (Oxy) with one of the largest acreage positions in the Delaware Basin. Expanded materially via the 2019 Anadarko and 2024 CrownRock deals.",
    operatingRadiusMiles: 225,
    brandPrimaryColor: "#E4002B",
    brandAccentColor: "#5A6770",
  },
  {
    name: "Devon Energy",
    contactName: "Operations Desk",
    contactEmail: "ops@devon.example.com",
    contactPhone: "(405) 235-3611",
    businessPhone: "(405) 235-3611",
    physicalAddress: "333 W Sheridan Ave, Oklahoma City, OK 73102",
    billingAddress: "333 W Sheridan Ave, Oklahoma City, OK 73102",
    hoursOfOperation: "24/7 field operations · M–F 8a–5p HQ",
    blurb:
      "Top-tier multi-basin independent. Largest acreage and production weighting now sits in the Delaware Basin following the 2021 WPX merger.",
    operatingRadiusMiles: 200,
    brandPrimaryColor: "#0033A0",
    brandAccentColor: "#9CCB3B",
  },
  {
    name: "EOG Resources",
    contactName: "Operations Desk",
    contactEmail: "ops@eog.example.com",
    contactPhone: "(713) 651-7000",
    businessPhone: "(713) 651-7000",
    physicalAddress: "1111 Bagby St, Sky Lobby 2, Houston, TX 77002",
    billingAddress: "1111 Bagby St, Sky Lobby 2, Houston, TX 77002",
    hoursOfOperation: "24/7 field operations · M–F 8a–5p HQ",
    blurb:
      "Formerly Enron Oil & Gas (spun off 1999). One of the largest U.S. shale operators with a dominant Delaware Basin position.",
    operatingRadiusMiles: 200,
    brandPrimaryColor: "#A6192E",
    brandAccentColor: "#1B365D",
  },
  {
    name: "APA Corporation (Apache)",
    contactName: "Operations Desk",
    contactEmail: "ops@apa.example.com",
    contactPhone: "(713) 296-6000",
    businessPhone: "(713) 296-6000",
    physicalAddress: "2000 Post Oak Blvd, Suite 100, Houston, TX 77056",
    billingAddress: "2000 Post Oak Blvd, Suite 100, Houston, TX 77056",
    hoursOfOperation: "24/7 field operations · M–F 8a–5p HQ",
    blurb:
      "Holding company of Apache Corporation. Operates the Alpine High play and other Delaware Basin assets in the southern Permian.",
    operatingRadiusMiles: 200,
    brandPrimaryColor: "#003DA5",
    brandAccentColor: "#E87722",
  },
  {
    name: "Coterra Energy",
    contactName: "Operations Desk",
    contactEmail: "ops@coterra.example.com",
    contactPhone: "(281) 589-4600",
    businessPhone: "(281) 589-4600",
    physicalAddress: "Three Memorial City Plaza, 840 Gessner Rd, Suite 1400, Houston, TX 77024",
    billingAddress: "Three Memorial City Plaza, 840 Gessner Rd, Suite 1400, Houston, TX 77024",
    hoursOfOperation: "24/7 field operations · M–F 8a–5p HQ",
    blurb:
      "Formed from the 2021 merger of Cabot Oil & Gas and Cimarex Energy. Permian production weighted toward the Delaware Basin and Culberson County.",
    operatingRadiusMiles: 175,
    brandPrimaryColor: "#0E4D2A",
    brandAccentColor: "#F7A800",
  },
  {
    name: "Permian Resources",
    contactName: "Operations Desk",
    contactEmail: "ops@permianres.example.com",
    contactPhone: "(432) 695-4222",
    businessPhone: "(432) 695-4222",
    physicalAddress: "300 N Marienfeld St, Suite 1000, Midland, TX 79701",
    billingAddress: "300 N Marienfeld St, Suite 1000, Midland, TX 79701",
    hoursOfOperation: "24/7 field operations · M–F 8a–5p HQ",
    blurb:
      "Pure-play Delaware Basin operator formed from the 2022 merger of Centennial Resource Development and Colgate Energy.",
    operatingRadiusMiles: 175,
    brandPrimaryColor: "#1B365D",
    brandAccentColor: "#D6A04A",
  },
  {
    name: "BP America (BPX Energy)",
    contactName: "Operations Desk",
    contactEmail: "ops@bp.example.com",
    contactPhone: "(281) 366-2000",
    businessPhone: "(281) 366-2000",
    physicalAddress: "201 Helios Way, Houston, TX 77079",
    billingAddress: "201 Helios Way, Houston, TX 77079",
    hoursOfOperation: "24/7 field operations · M–F 8a–5p HQ",
    blurb:
      "BP's U.S. onshore arm (BPX Energy). Acquired BHP's Permian assets in 2018, anchoring BP's Lower 48 shale program in the Delaware Basin.",
    operatingRadiusMiles: 200,
    brandPrimaryColor: "#006F51",
    brandAccentColor: "#FFCB05",
  },
  {
    name: "Shell USA",
    contactName: "Operations Desk",
    contactEmail: "ops@shell.example.com",
    contactPhone: "(713) 241-6161",
    businessPhone: "(713) 241-6161",
    physicalAddress: "150 N Dairy Ashford Rd, Houston, TX 77079",
    billingAddress: "150 N Dairy Ashford Rd, Houston, TX 77079",
    hoursOfOperation: "24/7 field operations · M–F 8a–5p HQ",
    blurb:
      "U.S. arm of Shell plc. Sold its Delaware Basin position to ConocoPhillips in 2021 for $9.5B; remaining Permian footprint is more limited but operationally active.",
    operatingRadiusMiles: 200,
    brandPrimaryColor: "#FBCE07",
    brandAccentColor: "#DD1D21",
  },
  {
    name: "Marathon Oil",
    contactName: "Operations Desk",
    contactEmail: "ops@marathon.example.com",
    contactPhone: "(713) 629-6600",
    businessPhone: "(713) 629-6600",
    physicalAddress: "990 Town & Country Blvd, Houston, TX 77024",
    billingAddress: "990 Town & Country Blvd, Houston, TX 77024",
    hoursOfOperation: "24/7 field operations · M–F 8a–5p HQ",
    blurb:
      "Independent E&P with multi-basin U.S. acreage. Acquired by ConocoPhillips in November 2024; retained as an operating brand for several legacy programs.",
    operatingRadiusMiles: 200,
    brandPrimaryColor: "#005CB9",
    brandAccentColor: "#E4002B",
  },
  {
    name: "Mach Natural Resources",
    contactName: "Operations Desk",
    contactEmail: "ops@machresources.example.com",
    contactPhone: "(405) 252-2244",
    businessPhone: "(405) 252-2244",
    physicalAddress: "14201 Wireless Way, Oklahoma City, OK 73134",
    billingAddress: "14201 Wireless Way, Oklahoma City, OK 73134",
    hoursOfOperation: "24/7 field operations · M–F 8a–5p HQ",
    blurb:
      "Oklahoma City–based independent E&P (NYSE: MNR) led by Tom Ward. Anadarko Basin–focused operator with extensive SCOOP/STACK acreage; one of the most active mid-cap operators in the Mid-Continent.",
    operatingRadiusMiles: 200,
    brandPrimaryColor: "#0B2545",
    brandAccentColor: "#D6A04A",
  },
  {
    name: "Endeavor Energy Resources",
    contactName: "Operations Desk",
    contactEmail: "ops@endeavor.example.com",
    contactPhone: "(432) 818-3500",
    businessPhone: "(432) 818-3500",
    physicalAddress: "110 N Marienfeld St, Suite 200, Midland, TX 79701",
    billingAddress: "110 N Marienfeld St, Suite 200, Midland, TX 79701",
    hoursOfOperation: "24/7 field operations · M–F 8a–5p HQ",
    blurb:
      "Largest privately held Permian producer (founded by Autry Stephens). Combined with Diamondback Energy in 2024 to form Diamondback's expanded Midland Basin program.",
    operatingRadiusMiles: 175,
    brandPrimaryColor: "#1A2F4B",
    brandAccentColor: "#C5A572",
  },
  {
    name: "Continental Resources",
    contactName: "Operations Desk",
    contactEmail: "ops@continental.example.com",
    contactPhone: "(405) 234-9000",
    businessPhone: "(405) 234-9000",
    physicalAddress: "20 N Broadway Ave, Oklahoma City, OK 73102",
    billingAddress: "20 N Broadway Ave, Oklahoma City, OK 73102",
    hoursOfOperation: "24/7 field operations · M–F 8a–5p HQ",
    blurb:
      "Oklahoma City–based independent E&P founded by Harold Hamm. Largest leaseholder in the Bakken and a top operator in Oklahoma's SCOOP and STACK plays; taken private in late 2022.",
    operatingRadiusMiles: 250,
    brandPrimaryColor: "#1B3F8B",
    brandAccentColor: "#D7282F",
  },
  {
    name: "Matador Resources",
    contactName: "Operations Desk",
    contactEmail: "ops@matador.example.com",
    contactPhone: "(972) 371-5200",
    businessPhone: "(972) 371-5200",
    physicalAddress: "5400 LBJ Fwy, Suite 1500, Dallas, TX 75240",
    billingAddress: "5400 LBJ Fwy, Suite 1500, Dallas, TX 75240",
    hoursOfOperation: "24/7 field operations · M–F 8a–5p HQ",
    blurb:
      "Dallas-headquartered independent E&P (NYSE: MTDR). Pure-play Delaware Basin operator with concentrated acreage in Loving and Reeves counties; expanded materially via the 2023 Advance Energy Partners acquisition.",
    operatingRadiusMiles: 175,
    brandPrimaryColor: "#23335B",
    brandAccentColor: "#B8862A",
  },
  {
    name: "SM Energy",
    contactName: "Operations Desk",
    contactEmail: "ops@sm-energy.example.com",
    contactPhone: "(303) 861-8140",
    businessPhone: "(303) 861-8140",
    physicalAddress: "1700 Lincoln St, Suite 3200, Denver, CO 80203",
    billingAddress: "1700 Lincoln St, Suite 3200, Denver, CO 80203",
    hoursOfOperation: "24/7 field operations · M–F 8a–5p HQ",
    blurb:
      "Denver-based independent E&P (NYSE: SM). Two-basin program: Midland Basin (Howard/Martin counties) and South Texas Eagle Ford. Added Uinta Basin acreage via the 2024 XCL Resources deal.",
    operatingRadiusMiles: 200,
    brandPrimaryColor: "#0A2240",
    brandAccentColor: "#F58220",
  },
  {
    name: "Vital Energy",
    contactName: "Operations Desk",
    contactEmail: "ops@vital.example.com",
    contactPhone: "(918) 513-4570",
    businessPhone: "(918) 513-4570",
    physicalAddress: "521 E 2nd St, Suite 1000, Tulsa, OK 74120",
    billingAddress: "521 E 2nd St, Suite 1000, Tulsa, OK 74120",
    hoursOfOperation: "24/7 field operations · M–F 8a–5p HQ",
    blurb:
      "Tulsa-based independent E&P (NYSE: VTLE), formerly Laredo Petroleum (rebranded January 2023). Pure-play Permian operator concentrated in the Midland Basin (Howard, Glasscock, Reagan, Upton, Crockett counties).",
    operatingRadiusMiles: 175,
    brandPrimaryColor: "#0E2C4E",
    brandAccentColor: "#E2A724",
  },
  {
    name: "Ovintiv",
    contactName: "Operations Desk",
    contactEmail: "ops@ovintiv.example.com",
    contactPhone: "(303) 623-2300",
    businessPhone: "(303) 623-2300",
    physicalAddress: "370 17th St, Suite 1700, Denver, CO 80202",
    billingAddress: "370 17th St, Suite 1700, Denver, CO 80202",
    hoursOfOperation: "24/7 field operations · M–F 8a–5p HQ",
    blurb:
      "Denver-headquartered multi-basin independent (NYSE: OVV); the U.S.-domiciled successor to Encana following its 2020 redomiciliation. Active in the Permian (Martin/Midland counties) and the Anadarko Basin SCOOP.",
    operatingRadiusMiles: 250,
    brandPrimaryColor: "#0A1F3A",
    brandAccentColor: "#7BB661",
  },
  {
    name: "Civitas Resources",
    contactName: "Operations Desk",
    contactEmail: "ops@civitas.example.com",
    contactPhone: "(303) 293-9100",
    businessPhone: "(303) 293-9100",
    physicalAddress: "555 17th St, Suite 3700, Denver, CO 80202",
    billingAddress: "555 17th St, Suite 3700, Denver, CO 80202",
    hoursOfOperation: "24/7 field operations · M–F 8a–5p HQ",
    blurb:
      "Denver-based independent E&P (NYSE: CIVI). Originally a DJ Basin pure-play; entered the Permian in 2023 via the Tap Rock and Hibernia acquisitions, picking up Delaware Basin and Midland Basin acreage.",
    operatingRadiusMiles: 200,
    brandPrimaryColor: "#1F3F2E",
    brandAccentColor: "#A0C846",
  },
  {
    name: "Ring Energy",
    contactName: "Operations Desk",
    contactEmail: "ops@ringenergy.example.com",
    contactPhone: "(281) 397-5828",
    businessPhone: "(281) 397-5828",
    physicalAddress: "1725 Hughes Landing Blvd, Suite 900, The Woodlands, TX 77380",
    billingAddress: "1725 Hughes Landing Blvd, Suite 900, The Woodlands, TX 77380",
    hoursOfOperation: "24/7 field operations · M–F 8a–5p HQ",
    blurb:
      "The Woodlands–based independent E&P (NYSE: REI) focused on the Central Basin Platform and Northwest Shelf of the Permian. Acreage concentrated in Andrews, Crane, Yoakum, and Gaines counties (Texas).",
    operatingRadiusMiles: 150,
    brandPrimaryColor: "#0E2746",
    brandAccentColor: "#C9A227",
  },
  {
    name: "Crownquest Operating",
    contactName: "Operations Desk",
    contactEmail: "ops@crownquest.example.com",
    contactPhone: "(432) 686-7800",
    businessPhone: "(432) 686-7800",
    physicalAddress: "400 W Illinois Ave, Suite 800, Midland, TX 79701",
    billingAddress: "400 W Illinois Ave, Suite 800, Midland, TX 79701",
    hoursOfOperation: "24/7 field operations · M–F 8a–5p HQ",
    blurb:
      "Midland-based privately held operator and the operating arm behind CrownRock LP (Crownquest + Lime Rock Partners JV). CrownRock's Midland Basin assets were sold to Occidental Petroleum in 2024 for ~$12B.",
    operatingRadiusMiles: 150,
    brandPrimaryColor: "#1A1A1A",
    brandAccentColor: "#C8A24B",
  },
];

const VENDORS: VendorSeed[] = [
  {
    name: "Halliburton",
    contactName: "Operations Desk",
    contactEmail: "ops@halliburton.example.com",
    contactPhone: "(281) 871-2699",
    businessPhone: "(281) 871-2699",
    physicalAddress: "3000 N Sam Houston Pkwy E, Houston, TX 77032",
    billingAddress: "3000 N Sam Houston Pkwy E, Houston, TX 77032",
    hoursOfOperation: "24/7 dispatch · field crews on-call",
    blurb:
      "Top-three global oilfield services company. Permian leader in pressure pumping (frac), cementing, drilling fluids, and wireline services.",
    operatingRadiusMiles: 300,
  },
  {
    name: "SLB (Schlumberger)",
    contactName: "Operations Desk",
    contactEmail: "ops@slb.example.com",
    contactPhone: "(281) 285-8500",
    businessPhone: "(281) 285-8500",
    physicalAddress: "5599 San Felipe St, Houston, TX 77056",
    billingAddress: "5599 San Felipe St, Houston, TX 77056",
    hoursOfOperation: "24/7 dispatch · field crews on-call",
    blurb:
      "World's largest oilfield services company (rebranded from Schlumberger to SLB in 2022). Full-service provider covering drilling, completion, production, and digital.",
    operatingRadiusMiles: 300,
  },
  {
    name: "Baker Hughes",
    contactName: "Operations Desk",
    contactEmail: "ops@bakerhughes.example.com",
    contactPhone: "(713) 439-8600",
    businessPhone: "(713) 439-8600",
    physicalAddress: "17021 Aldine Westfield Rd, Houston, TX 77073",
    billingAddress: "17021 Aldine Westfield Rd, Houston, TX 77073",
    hoursOfOperation: "24/7 dispatch · field crews on-call",
    blurb:
      "Top-three global oilfield services and energy technology company. Strong Permian presence in artificial lift, wireline, drilling services, and turbomachinery.",
    operatingRadiusMiles: 300,
  },
  {
    name: "Weatherford International",
    contactName: "Operations Desk",
    contactEmail: "ops@weatherford.example.com",
    contactPhone: "(713) 836-4000",
    businessPhone: "(713) 836-4000",
    physicalAddress: "2000 St James Place, Houston, TX 77056",
    billingAddress: "2000 St James Place, Houston, TX 77056",
    hoursOfOperation: "24/7 dispatch · field crews on-call",
    blurb:
      "Tier-1 global oilfield services provider. Permian focus on managed pressure drilling, tubular running services, completions, and artificial lift.",
    operatingRadiusMiles: 300,
  },
  {
    name: "Liberty Energy",
    contactName: "Operations Desk",
    contactEmail: "ops@liberty.example.com",
    contactPhone: "(303) 515-2800",
    businessPhone: "(303) 515-2800",
    physicalAddress: "950 17th St, Suite 2400, Denver, CO 80202",
    billingAddress: "950 17th St, Suite 2400, Denver, CO 80202",
    hoursOfOperation: "24/7 dispatch · field crews on-call",
    blurb:
      "Pure-play frac and completions services company. One of the largest North American pressure pumpers; significant Permian fleet deployment.",
    operatingRadiusMiles: 300,
  },
  {
    name: "ProPetro Holding",
    contactName: "Operations Desk",
    contactEmail: "ops@propetro.example.com",
    contactPhone: "(432) 688-0012",
    businessPhone: "(432) 688-0012",
    physicalAddress: "1706 S Midkiff Rd, Bldg B, Midland, TX 79701",
    billingAddress: "1706 S Midkiff Rd, Bldg B, Midland, TX 79701",
    hoursOfOperation: "24/7 dispatch · Midland-based field crews",
    blurb:
      "Midland-headquartered, Permian-pure-play completions services company. Hydraulic fracturing, wireline, cementing, and drilling.",
    operatingRadiusMiles: 200,
  },
  {
    name: "NOV Inc.",
    contactName: "Operations Desk",
    contactEmail: "ops@nov.example.com",
    contactPhone: "(713) 346-7500",
    businessPhone: "(713) 346-7500",
    physicalAddress: "10353 Richmond Ave, Houston, TX 77042",
    billingAddress: "10353 Richmond Ave, Houston, TX 77042",
    hoursOfOperation: "M–F 7a–6p · 24/7 emergency support",
    blurb:
      "National Oilwell Varco. Major manufacturer and supplier of drilling rigs, downhole tools, completion equipment, and oilfield consumables.",
    operatingRadiusMiles: 300,
  },
  {
    name: "Patterson-UTI Energy",
    contactName: "Operations Desk",
    contactEmail: "ops@patterson-uti.example.com",
    contactPhone: "(281) 765-7100",
    businessPhone: "(281) 765-7100",
    physicalAddress: "10713 W Sam Houston Pkwy N, Suite 800, Houston, TX 77064",
    billingAddress: "10713 W Sam Houston Pkwy N, Suite 800, Houston, TX 77064",
    hoursOfOperation: "24/7 rig operations",
    blurb:
      "Top-3 U.S. land driller and major pressure pumper. Combined with NexTier in 2023; one of the largest contract drilling fleets in the Permian.",
    operatingRadiusMiles: 300,
  },
  {
    name: "Nabors Industries",
    contactName: "Operations Desk",
    contactEmail: "ops@nabors.example.com",
    contactPhone: "(281) 874-0035",
    businessPhone: "(281) 874-0035",
    physicalAddress: "515 W Greens Rd, Suite 1200, Houston, TX 77067",
    billingAddress: "515 W Greens Rd, Suite 1200, Houston, TX 77067",
    hoursOfOperation: "24/7 rig operations",
    blurb:
      "One of the largest land-drilling contractors in the world. PACE-X and SmartRig fleets active across the Permian.",
    operatingRadiusMiles: 300,
  },
  {
    name: "Helmerich & Payne",
    contactName: "Operations Desk",
    contactEmail: "ops@hpinc.example.com",
    contactPhone: "(918) 742-5531",
    businessPhone: "(918) 742-5531",
    physicalAddress: "1437 S Boulder Ave, Suite 1400, Tulsa, OK 74119",
    billingAddress: "1437 S Boulder Ave, Suite 1400, Tulsa, OK 74119",
    hoursOfOperation: "24/7 rig operations",
    blurb:
      "Premier U.S. land driller (FlexRig fleet). One of the most active contract drillers in the Midland and Delaware Basins.",
    operatingRadiusMiles: 300,
  },
  {
    name: "ChampionX",
    contactName: "Operations Desk",
    contactEmail: "ops@championx.example.com",
    contactPhone: "(281) 263-5500",
    businessPhone: "(281) 263-5500",
    physicalAddress: "2445 Technology Forest Blvd, Bldg 4, Floor 12, The Woodlands, TX 77381",
    billingAddress: "2445 Technology Forest Blvd, Bldg 4, Floor 12, The Woodlands, TX 77381",
    hoursOfOperation: "M–F 7a–6p · 24/7 dispatch for production support",
    blurb:
      "Production chemistry, artificial lift (ESP/PCP), and digital production solutions. Being acquired by SLB (announced 2024).",
    operatingRadiusMiles: 300,
  },
  {
    name: "Cactus Inc.",
    contactName: "Operations Desk",
    contactEmail: "ops@cactus.example.com",
    contactPhone: "(713) 626-8800",
    businessPhone: "(713) 626-8800",
    physicalAddress: "920 Memorial City Way, Suite 300, Houston, TX 77024",
    billingAddress: "920 Memorial City Way, Suite 300, Houston, TX 77024",
    hoursOfOperation: "24/7 dispatch · field crews on-call",
    blurb:
      "Leading designer and manufacturer of wellheads and pressure control equipment. Major Permian field service footprint via Cactus Wellhead.",
    operatingRadiusMiles: 250,
  },
  {
    name: "Solaris Oilfield Infrastructure",
    contactName: "Operations Desk",
    contactEmail: "ops@solaris.example.com",
    contactPhone: "(281) 501-3070",
    businessPhone: "(281) 501-3070",
    physicalAddress: "9651 Katy Freeway, Suite 300, Houston, TX 77024",
    billingAddress: "9651 Katy Freeway, Suite 300, Houston, TX 77024",
    hoursOfOperation: "24/7 dispatch · field crews on-call",
    blurb:
      "Mobile sand-handling systems for hydraulic fracturing operations. Active across the Permian Basin and other major U.S. plays.",
    operatingRadiusMiles: 250,
  },
  {
    name: "Select Water Solutions",
    contactName: "Operations Desk",
    contactEmail: "ops@selectwater.example.com",
    contactPhone: "(713) 235-9500",
    businessPhone: "(713) 235-9500",
    physicalAddress: "1233 W Loop S, Suite 1400, Houston, TX 77027",
    billingAddress: "1233 W Loop S, Suite 1400, Houston, TX 77027",
    hoursOfOperation: "24/7 dispatch · water transfer crews on-call",
    blurb:
      "Largest U.S. provider of water management services for the upstream oil & gas industry. Sourcing, transfer, recycling, and disposal across the Permian.",
    operatingRadiusMiles: 250,
  },
  {
    name: "ProFrac Holding",
    contactName: "Operations Desk",
    contactEmail: "ops@profrac.example.com",
    contactPhone: "(254) 776-3722",
    businessPhone: "(254) 776-3722",
    physicalAddress: "333 Shops Blvd, Suite 301, Willow Park, TX 76087",
    billingAddress: "333 Shops Blvd, Suite 301, Willow Park, TX 76087",
    hoursOfOperation: "24/7 dispatch · field crews on-call",
    blurb:
      "Vertically integrated pressure pumper (NASDAQ: ACDC). Operates one of the largest electric and Tier-4 dual-fuel frac fleets in the Permian; owns frac sand mines (Alpine Silica) and proppant logistics.",
    operatingRadiusMiles: 300,
  },
  {
    name: "U.S. Silica Holdings",
    contactName: "Operations Desk",
    contactEmail: "ops@ussilica.example.com",
    contactPhone: "(281) 258-2170",
    businessPhone: "(281) 258-2170",
    physicalAddress: "24275 Katy Fwy, Suite 600, Katy, TX 77494",
    billingAddress: "24275 Katy Fwy, Suite 600, Katy, TX 77494",
    hoursOfOperation: "24/7 mine and rail logistics · field crews on-call",
    blurb:
      "Major North American producer of frac sand and industrial silica. Operates in-basin Permian sand mines and SandBox last-mile logistics; taken private by Apollo in 2024.",
    operatingRadiusMiles: 300,
  },
  {
    name: "Pason Systems",
    contactName: "Operations Desk",
    contactEmail: "ops@pason.example.com",
    contactPhone: "(403) 301-3400",
    businessPhone: "(403) 301-3400",
    physicalAddress: "6130 3rd St SE, Calgary, AB T2H 1K4, Canada",
    billingAddress: "6130 3rd St SE, Calgary, AB T2H 1K4, Canada",
    hoursOfOperation: "24/7 rig support · field crews on-call",
    blurb:
      "Calgary-based provider of drilling rig instrumentation, EDR (Electronic Drilling Recorder) systems, and well-site data services. Standard kit on the majority of land rigs operating in the Permian.",
    operatingRadiusMiles: 300,
  },
  {
    name: "Stallion Infrastructure Services",
    contactName: "Operations Desk",
    contactEmail: "ops@stallioninfra.example.com",
    contactPhone: "(713) 528-5544",
    businessPhone: "(713) 528-5544",
    physicalAddress: "950 Corbindale Rd, Suite 300, Houston, TX 77024",
    billingAddress: "950 Corbindale Rd, Suite 300, Houston, TX 77024",
    hoursOfOperation: "24/7 dispatch · 12 yards across the Permian",
    blurb:
      "Provider of well-site rentals, surface equipment, communications, and solids control. Field offices throughout the Permian, Eagle Ford, and Mid-Continent.",
    operatingRadiusMiles: 250,
  },
  {
    // NexTier Oilfield Solutions merged with Patterson-UTI Energy in
    // September 2023 and the NexTier brand has been retired. We keep
    // the legacy row as its own vendor (rather than collapsing it into
    // Patterson-UTI) because field paperwork, equipment decals, and
    // historical invoices still reference NexTier — `dedupe-vendors.ts`
    // and `seed-vendor-branding.ts` both document this "retired brand
    // kept as its own row" intent. Listing it here makes the Permian
    // seed self-contained so a fresh DB has the row that the branding
    // seed expects.
    name: "NexTier Oilfield Solutions",
    contactName: "Operations Desk",
    contactEmail: "ops@nextier.example.com",
    contactPhone: "(713) 325-6000",
    businessPhone: "(713) 325-6000",
    physicalAddress: "3990 Rogerdale Rd, Houston, TX 77042",
    billingAddress: "3990 Rogerdale Rd, Houston, TX 77042",
    hoursOfOperation: "24/7 dispatch · field crews on-call",
    blurb:
      "Legacy pure-play U.S. completions services brand (formerly NYSE: NEX). Pressure pumping, wireline, cementing, and last-mile sand logistics across the Permian and Mid-Continent. Merged into Patterson-UTI Energy in September 2023; retained as its own row because field paperwork and equipment still carry the NexTier wordmark.",
    operatingRadiusMiles: 300,
  },
];

/**
 * Merge new fields into an existing row WITHOUT overwriting any
 * non-blank value the user may already have entered.
 */
function mergeBlanks<T extends Record<string, unknown>>(
  existing: T,
  incoming: Record<string, unknown>,
): Partial<T> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (v == null || v === "") continue;
    const cur = (existing as Record<string, unknown>)[k];
    if (cur == null || cur === "") {
      patch[k] = v;
    }
  }
  return patch as Partial<T>;
}

export type SeedCounts = {
  inserted: number;
  enriched: number;
  unchanged: number;
};

export async function seedPartners(): Promise<SeedCounts> {
  let inserted = 0;
  let enriched = 0;
  let unchanged = 0;
  for (const seed of PARTNERS) {
    // Match against the canonical (lower(btrim(name))) form so a re-seed
    // is idempotent even when the existing row's name differs only in
    // case or surrounding whitespace. This mirrors the
    // partners_canonical_name_unique DB index — without it, a re-seed
    // against a hand-edited row would now hit a unique-violation
    // instead of silently inserting a duplicate.
    const [existing] = await db
      .select()
      .from(partnersTable)
      .where(sql`lower(btrim(${partnersTable.name})) = lower(btrim(${seed.name}))`)
      .limit(1);
    if (!existing) {
      await db.insert(partnersTable).values(seed);
      inserted++;
      console.log(`  + inserted partner: ${seed.name}`);
    } else {
      const patch = mergeBlanks(existing, seed);
      if (Object.keys(patch).length > 0) {
        await db.update(partnersTable).set(patch).where(eq(partnersTable.id, existing.id));
        enriched++;
        console.log(`  ~ enriched partner #${existing.id}: ${seed.name}  (${Object.keys(patch).join(", ")})`);
      } else {
        unchanged++;
        console.log(`  · unchanged partner #${existing.id}: ${seed.name}`);
      }
    }
  }
  console.log(`Partners: +${inserted} inserted, ~${enriched} enriched, ${unchanged} unchanged.`);
  return { inserted, enriched, unchanged };
}

export async function seedVendors(): Promise<SeedCounts> {
  let inserted = 0;
  let enriched = 0;
  let unchanged = 0;
  for (const seed of VENDORS) {
    // Match against the canonical (lower(btrim(name))) form so a re-seed
    // is idempotent even when the existing row's name differs only in
    // case or surrounding whitespace. This mirrors the
    // vendors_canonical_name_unique DB index — without it, a re-seed
    // against a hand-edited row would now hit a unique-violation
    // instead of silently inserting a duplicate.
    const [existing] = await db
      .select()
      .from(vendorsTable)
      .where(sql`lower(btrim(${vendorsTable.name})) = lower(btrim(${seed.name}))`)
      .limit(1);
    if (!existing) {
      await db.insert(vendorsTable).values(seed);
      inserted++;
      console.log(`  + inserted vendor: ${seed.name}`);
    } else {
      const patch = mergeBlanks(existing, seed);
      if (Object.keys(patch).length > 0) {
        await db.update(vendorsTable).set(patch).where(eq(vendorsTable.id, existing.id));
        enriched++;
        console.log(`  ~ enriched vendor #${existing.id}: ${seed.name}  (${Object.keys(patch).join(", ")})`);
      } else {
        unchanged++;
        console.log(`  · unchanged vendor #${existing.id}: ${seed.name}`);
      }
    }
  }
  console.log(`Vendors:  +${inserted} inserted, ~${enriched} enriched, ${unchanged} unchanged.`);
  return { inserted, enriched, unchanged };
}

export async function main() {
  console.log("Seeding Permian Basin operators (partners)…");
  await seedPartners();
  console.log("");
  console.log("Seeding Permian Basin oilfield service companies (vendors)…");
  await seedVendors();
  console.log("");
  console.log("Done.");
}

// Only run when invoked directly (e.g. `tsx scripts/seed-permian-basin.ts`),
// not when imported from the test suite.
const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (await import("node:url"))
    .pathToFileURL(process.argv[1])
    .href === import.meta.url;

if (invokedDirectly) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
