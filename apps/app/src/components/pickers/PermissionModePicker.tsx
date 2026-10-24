import { useMemo } from "react";
import type { PermissionMode } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
} from "@bb/shared-ui/option-display";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { cn } from "@bb/shared-ui/lib/utils";
import { OptionPicker, type PickerOption } from "./OptionPicker";

const PERMISSION_MODE_LABEL = "Permission mode";

type PermissionModeOption = PickerOption<PermissionMode>;

function getPermissionModeCompactLabel(value: PermissionMode): string {
  switch (value) {
    case "full":
      return "Full";
    case "accept-edits":
      return "Edits";
    case "auto":
      return "Auto";
  }
}

function addPermissionModeCompactLabels(
  options: readonly PermissionModeOption[],
): PermissionModeOption[] {
  return options.map((option) => ({
    ...option,
    compactLabel:
      option.compactLabel ?? getPermissionModeCompactLabel(option.value),
  }));
}

export interface PermissionModePickerProps {
  value?: PermissionMode;
  options: readonly PickerOption<PermissionMode>[];
  onChange: (value: PermissionMode) => void;
  supported: boolean;
  className?: string;
  muted?: boolean;
  defaultOpen?: boolean;
  modal?: boolean;
  align?: "start" | "center" | "end";
  displayOverride?: {
    label: string;
    compactLabel?: string;
    description?: string;
    title?: string;
  };
  disabled?: boolean;
  loading?: boolean;
  showChevronWhenDisabled?: boolean;
  showWhenSingleOption?: boolean;
}

function PermissionModeLoadingTrigger({
  className,
  muted,
}: {
  className?: string;
  muted: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={PERMISSION_MODE_LABEL}
      aria-busy="true"
      disabled
      className={cn(
        OPTION_BASE_CLASS_NAME,
        OPTION_INTERACTIVE_CLASS_NAME,
        muted && OPTION_MUTED_CLASS_NAME,
        "cursor-default disabled:opacity-100",
        className,
      )}
    >
      <Skeleton
        aria-hidden
        data-permission-mode-loading-placeholder=""
        className="h-3 w-14 shrink-0 rounded-sm"
      />
    </Button>
  );
}

export function PermissionModePicker({
  value,
  options,
  onChange,
  supported,
  className,
  muted = true,
  defaultOpen,
  modal,
  align = "end",
  displayOverride,
  disabled,
  loading = false,
  showChevronWhenDisabled,
  showWhenSingleOption = false,
}: PermissionModePickerProps) {
  const compactOptions = useMemo(
    () => addPermissionModeCompactLabels(options),
    [options],
  );
  if (loading) {
    return <PermissionModeLoadingTrigger className={className} muted={muted} />;
  }
  if (
    !supported ||
    value === undefined ||
    (!showWhenSingleOption && options.length <= 1)
  ) {
    return null;
  }
  return (
    <OptionPicker
      label={PERMISSION_MODE_LABEL}
      value={value}
      options={compactOptions}
      onChange={onChange}
      className={cn(LIST_HOVER_TRANSITION, className)}
      caretClassName="text-subtle-foreground/75"
      contentClassName="max-w-72"
      muted={muted}
      defaultOpen={defaultOpen}
      modal={modal}
      align={align}
      displayOverride={displayOverride}
      disabled={disabled || options.length <= 1}
      showChevronWhenDisabled={showChevronWhenDisabled}
    />
  );
}
