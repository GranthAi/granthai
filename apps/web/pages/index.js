import Head from "next/head";
import localFont from "next/font/local";
import styles from "@/styles/Home.module.scss";
import { useState, useRef } from "react";
import { Analytics } from "@vercel/analytics/react";

// Self-hosted Montserrat (variable, weights 100-900) so builds don't depend on reaching Google Fonts
const inter = localFont({
	src: "../node_modules/@fontsource-variable/montserrat/files/montserrat-latin-wght-normal.woff2",
	weight: "100 900"
});

export default function Home() {
	const component = useRef();
	const slider = useRef();
	const [state, setState] = useState({
		beforeSteps: [
			"Add Swagger to every service",
			"Write specs by hand",
			"Write MCP tools by hand",
			"Redo it on every change",
			"Still out of date"
		],
		socialsArr: [
			{ name: "Twitter", logo: "/twitter-logo.png", url: "#" },
			{ name: "Instagram", logo: "/instagram-logo.png", url: "https://insta.openinapp.co/1ns3u" },
			{ name: "Threads", logo: "/threads-logo.png", url: "https://openinapp.co/iamxd" },
			{ name: "Linkedin", logo: "/linkedin-logo.png", url: "#" }
		],
		afterSteps: ["Run one command", "Docs and MCP tools, always current"],
		mailTo: "manage.granthai@gmail.com",
		apisCount: 5
	});

	const handleClick = () => {
		window.open("/signup", "_blank");
	};

	const handleSocialClick = (url) => {
		window.open(url, "_blank");
	};

	const handleAPIRange = (eve) => {
		setState((prevState) => ({ ...prevState, apisCount: Number(eve.target.value) }));
	};

	return (
		<>
			<Head>
				<title>GranthAi - API docs and MCP tools from real traffic</title>
				<meta
					name="description"
					content="One command. Swagger docs and MCP tools for any backend, built from real traffic."
				/>
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<link rel="icon" href="/favicon.ico" />
				<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
				<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
				<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
				<link rel="manifest" href="/site.webmanifest" />{" "}
			</Head>
			<Analytics />
			<main className={`${styles.main} ${inter.className}`}>
				<div className={styles.heroSection}>
					<div className={styles.left}>
						<div className={styles.logo}>
							<img src={"/granthai-logo.svg"} />
						</div>
						<div className={styles.header}>
							Make your backend server <code>AI</code> ready
						</div>
						<div className={styles.subHeader}>
							Swagger docs and MCP tools, built from real traffic. No code changes.
						</div>
						<div className={styles.command}>
							<span>$</span> npx granthai-agent --target 8000
						</div>
						<div className={styles.seperator}></div>
						<div className={styles.callToAction} onClick={handleClick}>
							Sign up
						</div>
						<div className={styles.supportedTech}>
							<div>Any language. Any framework.</div>
							<img src={"/js-logo.svg"} />
							<img src={"/py-logo.svg"} />
							<img src={"/java-logo.svg"} />
							<img src={"/spring-logo.svg"} />
						</div>
					</div>
					<div className={styles.right}>
						{/* <img src={"/js-snippet.png"} /> */}
						<video autoPlay controls loop muted playsInline>
							<source
								src="/granthai-agent-demo.mp4"
								type="video/mp4"
							/>
						</video>
					</div>
				</div>
				<div className={styles.seperator} style={{ transform: "rotate(180deg)" }}></div>
				{/* <div className={styles.title}>How does it work?</div>
				<ScrollSection /> */}
				<div className={styles.beforeAfter}>
					<div className={styles.before}>
						<div className={styles.title}>The old way 😫</div>
						{state.beforeSteps.map((step, idx) => (
							<div className={styles.step}>
								<div className={styles.bullet}>
									{idx + 1 === state.beforeSteps.length ? <img src={"/tick.png"} /> : idx + 1}
								</div>
								{step}
							</div>
						))}
					</div>
					<div className={styles.after}>
						<div className={styles.title}>With GranthAi 😊</div>
						{state.afterSteps.map((step, idx) => (
							<div className={styles.step}>
								<div className={styles.bullet}>
									{idx + 1 === state.afterSteps.length ? <img src={"/tick.png"} /> : idx + 1}
								</div>
								{step}
							</div>
						))}
					</div>
				</div>
				<div className={styles.seperator}></div>

				{/* <div className={styles.pricing}>
					<div className={styles.title}>Pricing</div>
					<div className={styles.pricingBox}>
						<div className={styles.pricingBox_one}>
							<div>How many API's do you want to document?</div>
							<div>
								<input
									onChange={handleAPIRange}
									type="range"
									value={state.apisCount}
									step={5}
									min={0}
									max={500}
								></input>
							</div>
							<div className={styles.pricingBox_apiCount}>
								<span style={{ fontSize: "1.4rem" }}>{state.apisCount}</span> API's
							</div>
						</div>
						<div className={styles.pricingBox_two}>
							<div className={styles.pricingBox_two_left}>
								<div className={styles.pricingBox_two_left_1}>
									<div>Everything included</div>
								</div>
								<div className={styles.pricingBox_two_left_2}>
									<div className={styles.step}>
										<div className={styles.bullet}>
											<img src={"/tick.png"} />
										</div>
										Live hosting
									</div>
									<div className={styles.step}>
										<div className={styles.bullet}>
											<img src={"/tick.png"} />
										</div>
										Automatic API updation
									</div>
									<div className={styles.step}>
										<div className={styles.bullet}>
											<img src={"/tick.png"} />
										</div>
										Automatic API creation
									</div>
									<div className={styles.step}>
										<div className={styles.bullet}>
											<img src={"/tick.png"} />
										</div>
										Export to Postman
									</div>
								</div>
							</div>
							<div className={styles.pricingBox_two_right}>
								<div className={styles.pricingBox_apiRate}>
									{state.apisCount <= 10 && <span style={{ fontSize: "2.7rem" }}>FREE 🤝</span>}

									{state.apisCount > 10 && (
										<div>
											$
											<span style={{ fontSize: "2.7rem", marginLeft: "5px", fontWeight: "500" }}>
												{parseInt(state.apisCount * 1.25)}
											</span>
											<br />
											USD per month
										</div>
									)}
								</div>
								<div onClick={handleClick} className={styles.callToAction} style={{ width: "100%" }}>
									GET STARTED
								</div>
							</div>
						</div>
					</div>
				</div> */}
				<div className={styles.seperator} style={{ transform: "rotate(180deg)" }}></div>

				<div className={styles.lastSection}>
					<div className={styles.contactUs}>
						<div className={styles.title2}>Talk to us</div>
						<div>
							<a target="_blank" href={`https://openinapp.co/24jtf`}>
								{state.mailTo}
							</a>
						</div>
					</div>
					<div className={styles.socials}>
						<div className={styles.title2}>Follow us</div>
						<div className={styles.socialIcons}>
							{state.socialsArr.map((acc) => (
								<img onClick={() => handleSocialClick(acc.url)} src={acc.logo} />
							))}
						</div>
					</div>
				</div>
			</main>
		</>
	);
}
