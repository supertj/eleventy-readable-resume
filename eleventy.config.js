export default function (eleventyConfig) {
	// The content file sits outside src/, so Eleventy wouldn't rebuild on its own
	eleventyConfig.addWatchTarget("resume.yaml");
}

export const config = {
	dir: {
		input: "src",
		output: "_site",
	},
};
