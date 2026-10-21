import React from "react";
import styles from "@/styles/Home.module.scss";

// Google Form owned by ajagundeomkar@gmail.com, created with scripts/create-signup-form.gs
const SIGNUP_FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSd9jKbisfmHoqgIKMEjfV7ifqQJG2f5mqQoVXmyy4Iv_o7l_Q/viewform?embedded=true";

function Signup() {
	return (
		<div>
			<iframe className={styles.signupIframe} src={SIGNUP_FORM_URL} frameBorder="0" marginHeight="0" marginWidth="0" title="Use GranthAi without limits">
				Loading…
			</iframe>
		</div>
	);
}

export default Signup;
