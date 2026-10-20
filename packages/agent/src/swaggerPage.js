// Swagger UI page that loads the live spec from the agent, so a refresh shows new endpoints.
// "Try it out" requests go to this same origin, i.e. through the proxy, and get recorded too.
module.exports = function swaggerPage({ title, specUrl }) {
	const escapedTitle = String(title).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
	return `<!doctype html>
<html>
	<head>
		<meta charset="UTF-8">
		<title>${escapedTitle}</title>
		<link rel="stylesheet" type="text/css" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui.css">
		<style>.topbar { display: none; }</style>
	</head>
	<body>
		<div id="swagger-ui"></div>
		<script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui-bundle.js"></script>
		<script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui-standalone-preset.js"></script>
		<script>
			window.onload = function () {
				window.ui = SwaggerUIBundle({
					url: ${JSON.stringify(specUrl)},
					dom_id: "#swagger-ui",
					deepLinking: true,
					presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
					plugins: [SwaggerUIBundle.plugins.DownloadUrl],
					layout: "StandaloneLayout"
				});
			};
		</script>
	</body>
</html>`;
};
