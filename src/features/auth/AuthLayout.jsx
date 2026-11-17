import Card from '../../components/ui/Card.jsx';
import LogoTile from '../../components/ui/LogoTile.jsx';
import LanguageToggle from '../../components/layout/LanguageToggle.jsx';

/** The branded page around every signed-out and before-the-app screen: logo, title, a card for the form, the language toggle. */
export default function AuthLayout({ title, intro, wide = false, children }) {
  return (
    <main className="auth">
      <div className="auth__lang">
        <LanguageToggle />
      </div>
      <div className="auth__intro">
        <LogoTile size="md" float />
        <h1>{title}</h1>
        {intro ? <p>{intro}</p> : null}
      </div>
      <Card className={wide ? 'auth__card auth__card--doc' : 'auth__card'}>{children}</Card>
    </main>
  );
}
