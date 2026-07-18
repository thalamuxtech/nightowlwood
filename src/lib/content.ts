export const SITE = {
  name: "Nightowl Woodworks Ltd",
  shortName: "Nightowl Woodworks",
  slogan: "Precision in every cut.",
  location: "Nigeria",
  whatsappNumber: "+234 808 444 1277",
  whatsappHref:
    "https://wa.me/2348084441277?text=Hello%20I%20want%20to%20make%20an%20inquiry",
  instagram: "https://www.instagram.com/nightowlwoodworksng",
  instagramHandle: "@nightowlwoodworksng",
  tiktok: "https://www.tiktok.com/@nightowl.woodworks",
  tiktokHandle: "@nightowl.woodworks",
  pitchVideo: "https://youtu.be/WsBPFLjL4Nw",
  description:
    "Nightowl Woodworks Ltd is a modern wood processing and fabrication company delivering precision cutting, edge banding, and custom fabrication for construction and interior projects across Nigeria.",
  url: "https://nightowl-woodworks.web.app",
};

export const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/services/", label: "Services" },
  { href: "/work/", label: "Our Work" },
  { href: "/about/", label: "About" },
  { href: "/contact/", label: "Get a Quote" },
];

export const STATS = [
  { value: 150, suffix: "+", label: "Boards processed daily" },
  { value: 1000, suffix: "+", label: "Projects delivered" },
  { value: 100, suffix: "%", label: "Client satisfaction" },
];

export const ABOUT = {
  paragraphs: [
    "Nightowl Woodworks Ltd is a modern woodworking and fabrication company focused on precision board processing and high-quality wood components for construction and interior projects.",
    "We specialise in accurate cutting, edge banding, and custom fabrication — supporting contractors, developers, and furniture professionals with reliable, production-ready solutions.",
    "With a commitment to efficiency, quality, and attention to detail, every project meets industry standards while helping our clients achieve seamless installation and outstanding finishes.",
  ],
  pillars: ["Precision Cutting", "Modern Equipment", "Skilled Team", "On-Time Delivery"],
  vision:
    "To be a leading and trusted name in wood processing and fabrication — known for consistent quality, precision, and reliability in every project we undertake.",
  mission:
    "To provide high-quality cutting, edge banding, and fabrication services using modern equipment and skilled professionals, ensuring efficiency, accuracy, and timely delivery for every client.",
};

export interface Service {
  key: string;
  title: string;
  description: string;
}

export const SERVICES: Service[] = [
  {
    key: "cutting",
    title: "Precision Cutting",
    description:
      "Accurate cutting of MDF, plywood, and boards on high-precision sliding table saws — clean edges, exact dimensions, every time.",
  },
  {
    key: "edging",
    title: "Edge Banding",
    description:
      "Automated edge banding that seals and strengthens every panel with a clean, durable, furniture-grade finish.",
  },
  {
    key: "fabrication",
    title: "Fabrication",
    description:
      "Production of custom cabinets, panels, and furniture components — built to specification and ready for installation.",
  },
  {
    key: "custom",
    title: "Custom Processing",
    description:
      "Tailored solutions from your technical drawings and specifications, machined to tolerance for seamless assembly.",
  },
  {
    key: "delivery",
    title: "Delivery",
    description:
      "Reliable, on-schedule delivery that keeps your site moving — no delays, no excuses.",
  },
  {
    key: "advisory",
    title: "Technical Advisory",
    description:
      "Professional guidance on materials, design optimisation, and production efficiency before a single board is cut.",
  },
];

export interface WorkItem {
  slug: string;
  title: string;
  category: string;
  image: string;
  alt: string;
  description: string;
}

export const WORK_ITEMS: WorkItem[] = [
  {
    slug: "kitchen-installations",
    title: "Kitchen Installations",
    category: "Residential",
    image: "/images/kitchen.jpg",
    alt: "Custom fitted kitchen with precision-cut cabinetry by Nightowl Woodworks",
    description: "Precision-cut panels and finished components for modern kitchens.",
  },
  {
    slug: "closets-storage",
    title: "Closets & Storage",
    category: "Residential",
    image: "/images/closet.jpg",
    alt: "Custom closet and storage system fabricated by Nightowl Woodworks",
    description: "Custom fabrication for closets and efficient storage systems.",
  },
  {
    slug: "tv-wall-consoles",
    title: "TV Wall Consoles",
    category: "Commercial",
    image: "/images/tv.jpg",
    alt: "Fitted TV wall console with high-quality wood panels",
    description: "High-quality panels and finishing for commercial and living interiors.",
  },
  {
    slug: "consoles",
    title: "Consoles",
    category: "Residential",
    image: "/images/console.jpg",
    alt: "Durable custom wood console unit",
    description: "Durable and attractive wood components for homes.",
  },
  {
    slug: "doors",
    title: "Doors",
    category: "Joinery",
    image: "/images/doors.jpg",
    alt: "Custom fabricated interior doors with clean finishing",
    description: "Accurate cutting and professional finishing for custom doors.",
  },
  {
    slug: "frames",
    title: "Frames",
    category: "Joinery",
    image: "/images/frames.jpg",
    alt: "Custom wood frames machined to specification",
    description: "Tailored solutions based on unique designs and specifications.",
  },
];

export const PROCESS = [
  {
    step: "01",
    title: "Material Inspection",
    description:
      "Every board is checked for quality and consistency before production begins — substandard material never reaches the saw.",
  },
  {
    step: "02",
    title: "Precision Cutting",
    description:
      "Advanced sliding-table equipment delivers accurate cuts and clean edges to exact dimensions.",
  },
  {
    step: "03",
    title: "Finishing",
    description:
      "Professional edge banding and finishing processes seal, strengthen, and complete every component.",
  },
  {
    step: "04",
    title: "Final Inspection",
    description:
      "Each product is verified against specification before it leaves the factory — quality assured, ready to install.",
  },
];

export const INDUSTRIES = [
  {
    key: "construction",
    title: "Construction Companies",
    description: "Production-ready components delivered to site, on schedule.",
  },
  {
    key: "realestate",
    title: "Real Estate Developers",
    description: "Consistent quality at volume across entire developments.",
  },
  {
    key: "designers",
    title: "Interior Designers",
    description: "Exact execution of your drawings, tolerances, and finishes.",
  },
];

export const ADVANTAGES = ["Skilled Team", "Modern Machines", "Fast Delivery", "Quality Focus"];

export const MACHINES = [
  {
    title: "Sliding Table Saw",
    image: "/images/cutting.jpg",
    alt: "Sliding table saw cutting large boards at the Nightowl Woodworks factory",
    description: "High-precision panel cutting for large boards with clean, accurate edges.",
  },
  {
    title: "Edge Banding Machine",
    image: "/images/edging.jpg",
    alt: "Automated edge banding machine finishing board edges",
    description: "Automated finishing for strong, clean, and durable board edges.",
  },
];

export const TESTIMONIALS = [
  {
    quote:
      "Working with Nightowl Woodworks made my project much easier. Their team understands technical specifications and collaborates smoothly.",
    author: "Engr. Musa",
    role: "Contractor",
  },
  {
    quote:
      "We source large volumes of plywood cutting and edging. Their machines are modern and output is always accurate.",
    author: "Laminex Interiors Ltd.",
    role: "Interiors Partner",
  },
  {
    quote:
      "Nightowl Woodworks has been our go-to partner. Their craftsmanship is precise and they always deliver on time.",
    author: "Jide",
    role: "Interior Designer",
  },
];

export const TEAM = {
  paragraphs: [
    "Our team is made up of highly skilled machine operators, technicians, and craftsmen with extensive hands-on experience in precision wood processing and fabrication.",
    "We combine technical expertise with a strong commitment to quality, ensuring every project meets strict production standards — from cutting to finishing, with attention to detail, efficiency, and safety at every stage.",
    "We continuously invest in training and modern techniques to stay ahead of the industry and deliver consistent results our clients can rely on.",
  ],
};

export const AWARD = {
  headline: "Vice Chancellor Business Excellence & Community Impact Award 2026",
  paragraphs: [
    "Nightowl Woodworks emerged as a winner at an innovation and entrepreneurship competition hosted at Nile University — a significant milestone in the company's growth journey and a recognition of its commitment to excellence in woodworking and interior solutions in Nigeria.",
    "Founded by Asim Balarabe Yazid, Nightowl Woodworks designs and produces custom doors, kitchen cabinets, office furniture, and interior woodworks — combining modern machinery with skilled craftsmanship for residential and commercial clients.",
    "The award reinforces the brand's vision to expand its impact, grow production capacity, and contribute to the rise of local manufacturing.",
  ],
  images: [
    { src: "/images/award-1.jpg", alt: "Nightowl Woodworks receiving the Vice Chancellor Business Excellence Award at Nile University" },
    { src: "/images/award-2.jpg", alt: "Award ceremony moment at Nile University" },
    { src: "/images/award-3.jpg", alt: "Nightowl Woodworks team with the award" },
    { src: "/images/award-4.jpg", alt: "Award plaque presented to Nightowl Woodworks" },
  ],
};

export const COMPLIANCE = [
  { name: "CAC", image: "/images/compliance/cac.jpeg", alt: "Corporate Affairs Commission registered" },
  { name: "FIRS", image: "/images/compliance/firs.png", alt: "Federal Inland Revenue Service compliant" },
  { name: "ITF", image: "/images/compliance/itf.jpeg", alt: "Industrial Training Fund compliant" },
  { name: "NSITF", image: "/images/compliance/nsitf.png", alt: "Nigeria Social Insurance Trust Fund compliant" },
  { name: "SCUML", image: "/images/compliance/scuml.jpeg", alt: "SCUML registered" },
];

export const PROJECT_TYPES = [
  "Board cutting & edge banding",
  "Kitchen cabinets",
  "Closets & storage",
  "Doors & frames",
  "Office / commercial furniture",
  "Custom fabrication (drawings)",
  "Something else",
];

export const BUDGET_RANGES = [
  "Under ₦500,000",
  "₦500,000 – ₦2,000,000",
  "₦2,000,000 – ₦10,000,000",
  "₦10,000,000+",
  "Not sure yet",
];
