import type { ProductCategory } from "./enums";

/**
 * Estimate line-item templates, taken verbatim from
 * `planning/data_file_analysis/Nightowl Cost Estimate Template.xlsx`.
 *
 * 178 items across the six categories, in the spreadsheet's own order so anyone
 * used to the paper template reads down the same list.
 *
 * `kind` separates purchased materials from derived lines. Error Margin and
 * Nightowl Charges are percentages of the material subtotal rather than things
 * you buy, and Labour, Transport, Fuel and Cutting & Edging are lump sums rather
 * than quantity times unit price. Treating all of them as materials is what
 * makes a hand-built estimate drift, because the margin ends up inside the base
 * it is meant to be calculated from.
 */

export type EstimateItemKind = "material" | "derived";

export interface TemplateItem {
  item: string;
  kind: EstimateItemKind;
}

export interface CategoryTemplate {
  label: string;
  items: TemplateItem[];
}

export const ESTIMATE_TEMPLATES: Record<ProductCategory, CategoryTemplate> = {
  kitchen: {
    label: "Kitchen",
    items: [
      { item: "Board", kind: "material" },
      { item: "High Glossy", kind: "material" },
      { item: "Edge Tape", kind: "material" },
      { item: "Rollers", kind: "material" },
      { item: "Angles", kind: "material" },
      { item: "Nails", kind: "material" },
      { item: "super glue", kind: "material" },
      { item: "EVO Stick", kind: "material" },
      { item: "Hinges", kind: "material" },
      { item: "Hydraulic Lift", kind: "material" },
      { item: "Quarter Plywood", kind: "material" },
      { item: "Screw 2 inches", kind: "material" },
      { item: "Screw 1 and 1/4", kind: "material" },
      { item: "Screws 5/8", kind: "material" },
      { item: "Screw 2 1/2 inch", kind: "material" },
      { item: "Screws3 inch", kind: "material" },
      { item: "Fisher", kind: "material" },
      { item: "Marble top", kind: "material" },
      { item: "Glass", kind: "material" },
      { item: "LED", kind: "material" },
      { item: "LED Profile", kind: "material" },
      { item: "Copper Cable", kind: "material" },
      { item: "Pressing Gum", kind: "material" },
      { item: "Push to Open", kind: "material" },
      { item: "Handle", kind: "material" },
      { item: "Angle Rubber Wall Mount", kind: "material" },
      { item: "Legs", kind: "material" },
      { item: "Cutting & Edging", kind: "derived" },
      { item: "Transport", kind: "derived" },
      { item: "Fuel", kind: "derived" },
      { item: "Labour", kind: "derived" },
      { item: "Error Margin", kind: "derived" },
      { item: "Nightowl Charges", kind: "derived" },
    ],
  },
  doors: {
    label: "Doors",
    items: [
      { item: "Egger Board", kind: "material" },
      { item: "Board 1/2 inch", kind: "material" },
      { item: "Quarter", kind: "material" },
      { item: "Half inch board", kind: "material" },
      { item: "Aluko Board", kind: "material" },
      { item: "Edge Tape", kind: "material" },
      { item: "Fish Foam Red", kind: "material" },
      { item: "Super Glue", kind: "material" },
      { item: "Pressing Gum (Zuma)", kind: "material" },
      { item: "Hinges black", kind: "material" },
      { item: "Screw 2 inches", kind: "material" },
      { item: "Screw 2 inches", kind: "material" },
      { item: "Screw 1 and 1/4", kind: "material" },
      { item: "Screws 5/8", kind: "material" },
      { item: "Screw 2 1/2 inch", kind: "material" },
      { item: "Screws3 inch", kind: "material" },
      { item: "Door Rubber", kind: "material" },
      { item: "Door Handle", kind: "material" },
      { item: "Door Stopper", kind: "material" },
      { item: "Cutting & Edging", kind: "derived" },
      { item: "Labour", kind: "derived" },
      { item: "Transport", kind: "derived" },
      { item: "Top Bond 1 litre", kind: "material" },
      { item: "Fuel", kind: "derived" },
      { item: "Error Margin", kind: "derived" },
      { item: "Pieces", kind: "derived" },
    ],
  },
  frames: {
    label: "Frames",
    items: [
      { item: "Board", kind: "material" },
      { item: "Edge Tape", kind: "material" },
      { item: "Nails", kind: "material" },
      { item: "Pressing Gum", kind: "material" },
      { item: "EVO Stick", kind: "material" },
      { item: "Screw 2 inches", kind: "material" },
      { item: "Screw 2 inches", kind: "material" },
      { item: "Screw 1 and 1/4", kind: "material" },
      { item: "Screws 5/8", kind: "material" },
      { item: "Screw 2 1/2 inch", kind: "material" },
      { item: "Screws 3 inch", kind: "material" },
      { item: "Fish foam", kind: "material" },
      { item: "Cutting & Edging", kind: "derived" },
      { item: "Transport", kind: "derived" },
      { item: "Labour", kind: "derived" },
      { item: "Fuel", kind: "derived" },
      { item: "Pieces", kind: "derived" },
      { item: "Error Margin", kind: "derived" },
    ],
  },
  tv_wall_panels: {
    label: "TV Wall Panels",
    items: [
      { item: "PVC", kind: "material" },
      { item: "Nail free", kind: "material" },
      { item: "High Glossy", kind: "material" },
      { item: "Board", kind: "material" },
      { item: "Wall Board", kind: "material" },
      { item: "Kwali (Base)", kind: "material" },
      { item: "Quarter", kind: "material" },
      { item: "Colish", kind: "material" },
      { item: "Rollers", kind: "material" },
      { item: "Angles", kind: "material" },
      { item: "Screw 2 inches", kind: "material" },
      { item: "Screw 1 and 1/4", kind: "material" },
      { item: "Screws 5/8", kind: "material" },
      { item: "Screw 2 1/2 inch", kind: "material" },
      { item: "Screws3 inch", kind: "material" },
      { item: "Hinges", kind: "material" },
      { item: "Hydraulic Lift", kind: "material" },
      { item: "Cutting & Edging", kind: "derived" },
      { item: "LED", kind: "material" },
      { item: "LED Profile", kind: "material" },
      { item: "Pressing Gum", kind: "material" },
      { item: "Wallpapper", kind: "material" },
      { item: "Copper Cable", kind: "material" },
      { item: "Push to Open", kind: "material" },
      { item: "Handle", kind: "material" },
      { item: "Angle Rubber Wall Mount", kind: "material" },
      { item: "Legs", kind: "material" },
      { item: "Transport", kind: "derived" },
      { item: "Labour", kind: "derived" },
      { item: "Fuel", kind: "derived" },
      { item: "Error Margin", kind: "derived" },
      { item: "Nightowl Charges", kind: "derived" },
    ],
  },
  closets: {
    label: "Closets",
    items: [
      { item: "MDF", kind: "material" },
      { item: "High glossy", kind: "material" },
      { item: "Quarter Plywood", kind: "material" },
      { item: "Kwali", kind: "material" },
      { item: "Edge Tape", kind: "material" },
      { item: "Angles", kind: "material" },
      { item: "Nails", kind: "material" },
      { item: "Screw 2 inches", kind: "material" },
      { item: "Screw 1 and 1/4", kind: "material" },
      { item: "Screws 5/8", kind: "material" },
      { item: "Screw 2 1/2 inch", kind: "material" },
      { item: "Screws3 inch", kind: "material" },
      { item: "EVO stick", kind: "material" },
      { item: "Hinges", kind: "material" },
      { item: "Hydraulic Lift", kind: "material" },
      { item: "Sliders", kind: "material" },
      { item: "Push to Open", kind: "material" },
      { item: "Hanger", kind: "material" },
      { item: "LED", kind: "material" },
      { item: "LED Profile", kind: "material" },
      { item: "Pressing Gum", kind: "material" },
      { item: "Wallpapper", kind: "material" },
      { item: "Copper Cable", kind: "material" },
      { item: "Handles", kind: "material" },
      { item: "Rollers", kind: "material" },
      { item: "Cutting & Edging", kind: "derived" },
      { item: "Transport", kind: "derived" },
      { item: "Labour", kind: "derived" },
      { item: "Fuel", kind: "derived" },
      { item: "Error Margin", kind: "derived" },
      { item: "Nightowl Charges", kind: "derived" },
    ],
  },
  bedset: {
    label: "Bedset",
    items: [
      { item: "Board", kind: "material" },
      { item: "High Glossy", kind: "material" },
      { item: "Quarter Plywood", kind: "material" },
      { item: "Kwali", kind: "material" },
      { item: "Aluko board", kind: "material" },
      { item: "Edge Tape", kind: "material" },
      { item: "Rollers", kind: "material" },
      { item: "Angles", kind: "material" },
      { item: "Nails", kind: "material" },
      { item: "super glue", kind: "material" },
      { item: "EVO Stick", kind: "material" },
      { item: "Hinges", kind: "material" },
      { item: "Hydraulic Lift", kind: "material" },
      { item: "Screw 2 inches", kind: "material" },
      { item: "Screw 1 and 1/4", kind: "material" },
      { item: "Screws 5/8", kind: "material" },
      { item: "Screw 2 1/2 inch", kind: "material" },
      { item: "Screws3 inch", kind: "material" },
      { item: "Fisher", kind: "material" },
      { item: "Marble top", kind: "material" },
      { item: "Glass", kind: "material" },
      { item: "Mirror", kind: "material" },
      { item: "LED", kind: "material" },
      { item: "LED Profile", kind: "material" },
      { item: "Copper Cable", kind: "material" },
      { item: "Pressing Gum", kind: "material" },
      { item: "Push to Open", kind: "material" },
      { item: "Handles", kind: "material" },
      { item: "Angle Rubber Wall Mount", kind: "material" },
      { item: "Legs", kind: "material" },
      { item: "Cutting & Edging", kind: "derived" },
      { item: "Padding", kind: "material" },
      { item: "Bedhook", kind: "material" },
      { item: "Transport & Wrapping", kind: "derived" },
      { item: "Fuel", kind: "derived" },
      { item: "Labour", kind: "derived" },
      { item: "Error Margin", kind: "derived" },
      { item: "Nightowl Charges", kind: "derived" },
    ],
  },
};

/** Item count for a category, shown in the template picker. */
export function templateItemCount(category: ProductCategory): number {
  return ESTIMATE_TEMPLATES[category].items.length;
}

/** Purchased items only, so a materials subtotal can exclude the derived lines. */
export function materialItems(category: ProductCategory): TemplateItem[] {
  return ESTIMATE_TEMPLATES[category].items.filter((i) => i.kind === "material");
}
