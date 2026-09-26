import type { NavigatorScreenParams } from "@react-navigation/native";

export type DrawerParamList = {
  Chat: undefined;
};

export type RootStackParamList = {
  Main: NavigatorScreenParams<DrawerParamList> | undefined;
  Setup: undefined;
  Settings: undefined;
  Knowledge: undefined;
  Performance: undefined;
  About: undefined;
  /** Dev-only component catalog for visual QA. */
  Catalog: undefined;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
