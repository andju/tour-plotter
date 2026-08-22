<script lang="ts">
	import logoWordmark from "$lib/assets/logo-wordmark.svg";
	import logoWordmarkDark from "$lib/assets/logo-wordmark-dark.svg";
	import DropZone from "$lib/components/DropZone.svelte";
	import ExportPanel from "$lib/components/ExportPanel.svelte";
	import PreviewCanvas from "$lib/components/PreviewCanvas.svelte";
	import TrackListPanel from "$lib/components/TrackListPanel.svelte";
</script>

<svelte:head>
	<title>Tour Plotter</title>
</svelte:head>

<main>
	<picture>
		<source srcset={logoWordmarkDark} media="(prefers-color-scheme: dark)" />
		<img src={logoWordmark} alt="Tour Plotter" height="100" />
	</picture>

	<div class="layout">
		<div class="sidebar">
			<DropZone />
			<TrackListPanel />
			<ExportPanel />
		</div>
		<div class="preview">
			<PreviewCanvas />
		</div>
	</div>
</main>

<style>
	main {
		max-width: 1200px;
		margin: 0 auto;
		padding: 1.5rem;
		font-family: system-ui, sans-serif;
		color: var(--color-text);
	}
	.layout {
		display: grid;
		grid-template-columns: 320px 1fr;
		gap: 1.5rem;
		align-items: start;
	}
	.sidebar {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 0;
	}
</style>
