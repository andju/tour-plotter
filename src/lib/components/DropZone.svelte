<script lang="ts">
	import { trackList } from '$lib/state/tracks.svelte';

	let dragging = $state(false);
	let fileInput: HTMLInputElement;

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		if (e.dataTransfer?.files.length) trackList.addFiles(e.dataTransfer.files);
	}

	function onFileInputChange(e: Event) {
		const files = (e.target as HTMLInputElement).files;
		if (files?.length) trackList.addFiles(files);
		fileInput.value = '';
	}
</script>

<div
	class="dropzone"
	class:dragging
	ondragover={(e) => {
		e.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={onDrop}
	onclick={() => fileInput.click()}
	role="button"
	tabindex="0"
	onkeydown={(e) => e.key === 'Enter' && fileInput.click()}
>
	<p>Drop GPX files here, or click to choose</p>
	<input
		bind:this={fileInput}
		type="file"
		accept=".gpx"
		multiple
		onchange={onFileInputChange}
		style="display: none"
	/>
</div>

{#if trackList.errors.length > 0}
	<div class="errors">
		{#each trackList.errors as error}
			<p>{error}</p>
		{/each}
		<button onclick={() => trackList.dismissErrors()}>Dismiss</button>
	</div>
{/if}

<style>
	.dropzone {
		border: 2px dashed #bbb;
		border-radius: 8px;
		padding: 2rem;
		text-align: center;
		cursor: pointer;
		color: #666;
	}
	.dropzone.dragging {
		border-color: #5b8def;
		background: #eef4ff;
	}
	.errors {
		margin-top: 0.5rem;
		padding: 0.5rem 1rem;
		background: #fdecec;
		border-radius: 6px;
		color: #a02020;
	}
	.errors p {
		margin: 0.25rem 0;
	}
</style>
