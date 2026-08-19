<script lang="ts">
	import { TRACK_COLORS, normalizeHex } from '$lib/gpx/trackColors';

	let { value, onchange, label }: { value: string; onchange: (hex: string) => void; label?: string } = $props();

	let open = $state(false);
	// svelte-ignore state_referenced_locally -- intentional: `draft` is a local
	// editable copy, resynced explicitly on open/choose, not meant to track `value`.
	let draft = $state(value);
	let triggerEl: HTMLButtonElement | undefined = $state();

	function openPopover() {
		draft = value;
		open = true;
	}

	function choose(hex: string) {
		onchange(hex);
		draft = hex;
		open = false;
	}

	function commitDraft() {
		const normalized = normalizeHex(draft);
		if (normalized) {
			onchange(normalized);
			draft = normalized;
		}
	}

	function closeAndRestore() {
		open = false;
		draft = value;
	}

	$effect(() => {
		if (!open) return;

		function onPointerDown(e: PointerEvent) {
			const target = e.target as Node;
			if (triggerEl?.closest('.picker')?.contains(target)) return;
			open = false;
		}

		function onKeyDown(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				closeAndRestore();
				triggerEl?.focus();
			}
		}

		window.addEventListener('pointerdown', onPointerDown);
		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('pointerdown', onPointerDown);
			window.removeEventListener('keydown', onKeyDown);
		};
	});
</script>

<div class="picker">
	<button
		bind:this={triggerEl}
		type="button"
		class="swatch"
		style:background={value}
		aria-haspopup="dialog"
		aria-expanded={open}
		aria-label={label ?? 'Color'}
		onclick={() => (open ? closeAndRestore() : openPopover())}
	></button>

	{#if open}
		<div class="popover" role="dialog" aria-label={label ?? 'Color'}>
			<div class="grid">
				{#each TRACK_COLORS as c (c.hex)}
					<button
						type="button"
						class="chip"
						class:selected={c.hex === value.toLowerCase()}
						style:background={c.hex}
						title={c.name}
						aria-label={c.name}
						aria-pressed={c.hex === value.toLowerCase()}
						onclick={() => choose(c.hex)}
					></button>
				{/each}
			</div>
			<label class="hex-field">
				Hex
				<input
					type="text"
					class="hex"
					class:invalid={draft !== '' && normalizeHex(draft) === null}
					value={draft}
					maxlength="7"
					spellcheck="false"
					autocapitalize="off"
					oninput={(e) => {
						draft = (e.target as HTMLInputElement).value;
						commitDraft();
					}}
					onblur={() => {
						if (normalizeHex(draft) === null) draft = value;
					}}
					onkeydown={(e) => {
						if (e.key === 'Enter') commitDraft();
						else if (e.key === 'Escape') {
							closeAndRestore();
							triggerEl?.focus();
						}
					}}
				/>
			</label>
		</div>
	{/if}
</div>

<style>
	.picker {
		position: relative;
	}
	.swatch {
		width: 1.6rem;
		height: 1.6rem;
		flex-shrink: 0;
		padding: 0;
		border: 1px solid #ccc;
		border-radius: 4px;
		cursor: pointer;
	}
	.popover {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		z-index: 20;
		background: white;
		border: 1px solid #ccc;
		border-radius: 6px;
		padding: 0.5rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		width: 9.5rem;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 0.25rem;
	}
	.chip {
		width: 1.5rem;
		height: 1.5rem;
		padding: 0;
		border: 1px solid rgba(0, 0, 0, 0.15);
		border-radius: 4px;
		cursor: pointer;
	}
	.chip.selected {
		outline: 2px solid #5b8def;
		outline-offset: 1px;
	}
	.hex-field {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		margin-top: 0.5rem;
		font-size: 0.8rem;
		color: #555;
	}
	.hex {
		flex: 1;
		min-width: 0;
		border: 1px solid #ddd;
		border-radius: 4px;
		font-size: 0.85rem;
		font-family: monospace;
		padding: 0.1rem 0.3rem;
	}
	.hex.invalid {
		border-color: #a02020;
	}
</style>
