/**
 * Live status of the preview's basemap load, kept as shared state so
 * ExportPanel can gate its export buttons on it without independently
 * re-polling the network. This is a UX preflight signal only — the export
 * path always performs its own basemap load at export resolution (see
 * ExportPanel.svelte), since export and preview render at different zooms
 * and must not share loaded tile data.
 */
class BasemapStatusState {
	status: 'idle' | 'loading' | 'ready' | 'error' = $state('idle');
	error: string | null = $state(null);
}

export const basemapStatus = new BasemapStatusState();
