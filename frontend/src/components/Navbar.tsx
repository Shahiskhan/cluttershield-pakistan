import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function Navbar() {
  const { user, roles, signOut } = useAuth();
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="brand" to="/" aria-label="ClutterShield Pakistan home">
          <span className="brand-mark" aria-hidden="true">C</span>
          <span>ClutterShield <small>Pakistan</small></span>
        </Link>
        <nav className="header-nav" aria-label="Main navigation">
          <Link to="/citizen/report">Report</Link>
          <Link to="/citizen/track">Track</Link>
          {user && roles.includes("platform_admin") && <Link to="/admin">Admin portal</Link>}
          {user && !roles.includes("platform_admin") && (roles.includes("moderator") || roles.includes("senior_reviewer")) && <Link to="/moderator">Review console</Link>}
          {user && !roles.includes("platform_admin") && roles.some((role) => ["citizen", "analyst", "mentor", "senior_reviewer"].includes(role)) && <Link to="/researcher">Researcher portal</Link>}
          {!user && <Link to={"/auth?mode=signup&next=%2Fresearcher"}>Join as researcher</Link>}
          {user ? <button className="link-button" onClick={() => void signOut()}>Sign out</button> : <Link to="/auth">Sign in</Link>}
        </nav>
      </div>
    </header>
  );
}
