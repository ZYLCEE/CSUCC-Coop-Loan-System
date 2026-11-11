import Image from "next/image";
import cooperativeLogo from "../../../assets/csucc-logo2.png";
import styles from "./CoopLoginLoadingScreen.module.css";

export function CoopLoginLoadingScreen({
  exiting,
  error,
}: {
  exiting: boolean;
  error: string | null;
}) {
  return (
    <div className={`${styles.screen} ${exiting ? styles.exiting : ""}`} inert={exiting}>
      <div className={styles.content}>
        <div className={styles.logo}>
          <Image
            src={cooperativeLogo}
            alt=""
            sizes="(max-width: 810px) max(176px, 32vw), 260px"
            loading="eager"
            className={styles.seal}
          />
        </div>
        <h1 className={styles.title}><span>CSUCC</span> ERMPC Admin System</h1>
        <div className={styles.light} aria-hidden="true" />
        {error ? (
          <>
            <p className={styles.message} role="alert">{error}</p>
            <button type="button" className={styles.return} onClick={() => window.location.replace("/login")}>
              Return to sign in
            </button>
          </>
        ) : (
          <>
            <p className={styles.message} aria-hidden="true">
              Signing you in<span className={styles.dots}><span>.</span><span>.</span><span>.</span></span>
            </p>
            <span className={styles.spinner} aria-hidden="true" />
          </>
        )}
      </div>
    </div>
  );
}
