require("ts-node").register({ transpileOnly: true });
const argv = process.argv.slice(2);
require(`./${argv[0]}`)
	.run(argv.slice(1))
	.catch((e) => {
		console.error(e);
		process.exit(1);
	});
