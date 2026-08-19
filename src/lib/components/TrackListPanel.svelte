<script lang="ts">
	import { trackList } from '$lib/state/tracks.svelte';
	import ColorPicker from './ColorPicker.svelte';
</script>

{#if trackList.tracks.length === 0}
	<p class="empty">No tracks loaded yet.</p>
{:else}
	<ul class="track-list">
		{#each trackList.tracks as track (track.id)}
			<li>
				<div class="row">
					<ColorPicker
						value={track.style.color}
						label={`Color for ${track.name}`}
						onchange={(hex) => trackList.updateStyle(track.id, { color: hex })}
					/>
					<input
						type="text"
						value={track.name}
						class="name"
						onchange={(e) => trackList.rename(track.id, (e.target as HTMLInputElement).value)}
					/>
					<button onclick={() => trackList.remove(track.id)} aria-label="Remove">✕</button>
				</div>
				<div class="row controls">
					<label class="width" aria-label="Line width">
						<input
							type="range"
							min="0.5"
							max="12"
							step="0.25"
							value={track.style.widthPx}
							oninput={(e) => trackList.updateStyle(track.id, { widthPx: Number((e.target as HTMLInputElement).value) })}
						/>
						<input
							type="number"
							class="numeric"
							min="0.5"
							max="12"
							step="0.25"
							value={track.style.widthPx}
							oninput={(e) => trackList.updateStyle(track.id, { widthPx: Number((e.target as HTMLInputElement).value) })}
						/>
					</label>
					<label class="opacity" aria-label="Opacity">
						<input
							type="range"
							min="0.05"
							max="1"
							step="0.05"
							value={track.style.opacity}
							oninput={(e) => trackList.updateStyle(track.id, { opacity: Number((e.target as HTMLInputElement).value) })}
						/>
						<span class="readout">{Math.round(track.style.opacity * 100)}%</span>
					</label>
				</div>
				<div class="row actions">
					<label class="visible" title="Visible">
						<input
							type="checkbox"
							checked={track.style.visible}
							onchange={(e) => trackList.updateStyle(track.id, { visible: (e.target as HTMLInputElement).checked })}
						/>
						Visible
					</label>
					<div class="reorder">
						<button onclick={() => trackList.moveUp(track.id)} aria-label="Move up">↑</button>
						<button onclick={() => trackList.moveDown(track.id)} aria-label="Move down">↓</button>
					</div>
				</div>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.empty {
		color: #888;
	}
	.track-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.track-list li {
		padding: 0.4rem 0;
		border-bottom: 1px solid #eee;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
	}
	.row.controls {
		margin-top: 0.3rem;
	}
	.row.actions {
		margin-top: 0.3rem;
		justify-content: space-between;
	}
	.name {
		flex: 1;
		min-width: 0;
		border: none;
		background: transparent;
		font-size: 0.95rem;
	}
	.width,
	.opacity {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex: 1;
		min-width: 0;
	}
	.width input[type='range'],
	.opacity input[type='range'] {
		flex: 1;
		min-width: 0;
	}
	.numeric {
		width: 3.2rem;
		flex-shrink: 0;
		border: 1px solid #ddd;
		border-radius: 4px;
		font-size: 0.85rem;
		padding: 0.1rem 0.2rem;
	}
	.readout {
		flex-shrink: 0;
		width: 2.8rem;
		text-align: right;
		font-size: 0.85rem;
		color: #555;
	}
	.reorder {
		display: flex;
		gap: 0.15rem;
	}
	.actions .visible {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.85rem;
		color: #555;
	}
	button {
		flex-shrink: 0;
		border: none;
		background: transparent;
		cursor: pointer;
		font-size: 0.9rem;
		padding: 0.2rem 0.3rem;
	}
</style>
