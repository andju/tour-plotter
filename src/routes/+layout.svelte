<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import '@fontsource/roboto/400.css';
	import '@fontsource/roboto/700.css';
	import '@fontsource/roboto/400-italic.css';
	import '@fontsource/roboto/700-italic.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
