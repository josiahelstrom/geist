import React from "react";
import type {Site} from "../api";

export type LabSiteContextValue = {
	site?: Site;
};

export const LabSiteContext = React.createContext<LabSiteContextValue | null>(
	null,
);
