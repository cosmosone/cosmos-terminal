function svgAttrs(size: number): string {
  return `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
}

export function folderIcon(size = 14): string {
  return `<svg ${svgAttrs(size)}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
}

export function fileIcon(size = 14): string {
  return `<svg ${svgAttrs(size)}><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`;
}

export function chevronRightIcon(size = 14): string {
  return `<svg ${svgAttrs(size)}><polyline points="9 18 15 12 9 6"/></svg>`;
}

export function lockIcon(size = 14): string {
  return `<svg ${svgAttrs(size)}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
}

export function searchIcon(size = 14): string {
  return `<svg ${svgAttrs(size)}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
}
