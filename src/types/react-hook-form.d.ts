declare module "react-hook-form" {
  import type * as React from "react";

  export type FieldValues = Record<string, any>;
  export type FieldPath<TFieldValues extends FieldValues = FieldValues> =
    keyof TFieldValues extends string ? keyof TFieldValues : string;

  export interface ControllerRenderProps<
    TFieldValues extends FieldValues = FieldValues,
    TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>
  > {
    name: TName;
    value: any;
    onChange: (...event: any[]) => void;
  }

  export interface ControllerProps<
    TFieldValues extends FieldValues = FieldValues,
    TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>
  > {
    name: TName;
    control?: any;
    render: (props: { field: ControllerRenderProps<TFieldValues, TName> }) => React.ReactElement | null;
  }

  export function Controller<
    TFieldValues extends FieldValues = FieldValues,
    TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>
  >(props: ControllerProps<TFieldValues, TName>): JSX.Element;

  export function FormProvider(props: { children: React.ReactNode } & Record<string, any>): JSX.Element;

  export function useFormContext<TFieldValues extends FieldValues = FieldValues>(): {
    getFieldState: (name: FieldPath<TFieldValues>, formState: any) => any;
    formState: any;
  };

  export function useForm<TFieldValues extends FieldValues = FieldValues>(options?: any): {
    register: any;
    handleSubmit: any;
    control: any;
    reset: any;
    formState: { errors: any };
  };
}
