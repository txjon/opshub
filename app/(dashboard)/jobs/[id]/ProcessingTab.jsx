"use client";
import { useState, useEffect, useRef } from "react";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { createClient } from "@/lib/supabase/client";
import { uploadToDrive, registerFileInDb } from "@/lib/drive-upload-client";
import { logJobActivity } from "@/components/JobActivityPanel";

export const PLACEMENT_MAP = { 'Front':'Full Front','Full Front':'Full Front','Back':'Full Back','Full Back':'Full Back','Left Chest':'Left Chest','Right Chest':'Right Chest','Left Sleeve':'Left Sleeve','Right Sleeve':'Right Sleeve','Neck':'Neck','Hood':'Hood','Pocket':'Pocket' };
export const SKIP_GROUPS = ['Shirt Color','Shadows','Highlights','Mask','Client Art'];

export async function parsePsd(arrayBuffer) {
  const { readPsd } = await import("ag-psd");
  const psd = readPsd(new Uint8Array(arrayBuffer), { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true });
  const groups = [...(psd.children || [])].reverse();
  const locations = [];
  let hasTag = false;

  for (const group of groups) {
    if (SKIP_GROUPS.includes(group.name)) continue;
    const isTag = (group.name || "").toLowerCase() === "tag" || (group.name || "").toLowerCase() === "tags";
    if (isTag) { hasTag = true; continue; }
    if (!group.children || group.children.length === 0) continue;

    const colors = group.children
      .filter(l => !SKIP_GROUPS.includes(l.name) && l.name)
      .map(l => l.name);

    locations.push({
      placement: PLACEMENT_MAP[group.name] || group.name,
      colorCount: colors.length,
      colorNames: sortSizes(colors),
    });
  }

  return { locations, hasTag };
}

// (The ProcessingTab component was removed 2026-07-17 — dead since the tab
// merge; ProductBuilder imports parsePsd only. Full component in git history.)