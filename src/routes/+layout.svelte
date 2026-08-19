<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '@fontsource/roboto/400.css';
	import '@fontsource/roboto/700.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
